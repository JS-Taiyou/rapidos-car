// Cola offline de handovers (ROADMAP Fase 5): el patio captura entregas y
// devoluciones SIN red; el payload y las fotos (como blobs) esperan su turno
// en IndexedDB y se suben solos al volver la conexión. Un conflicto (otro
// staff cerró ese tramo mientras tanto) NO descarta el registro: queda
// marcado para revisión.
const DB_NAME = 'rapidos-offline';
const STORE = 'handovers';

export interface QueuedHandover {
  id: string;
  segmentId: number;
  code: string;
  segIdx: number;
  kind: 'out' | 'in';
  payload: {
    kind: 'out' | 'in';
    odometer: number;
    fuel: number;
    checklist: Record<string, boolean>;
    notes?: string;
  };
  photos: Array<{ name: string; blob: Blob }>;
  queuedAt: string;
  conflict?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const request = fn(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

export async function enqueue(item: QueuedHandover): Promise<void> {
  await tx('readwrite', (store) => store.put(item));
}

export async function listQueue(): Promise<QueuedHandover[]> {
  try {
    const all = await tx<QueuedHandover[]>('readonly', (store) => store.getAll() as IDBRequest<QueuedHandover[]>);
    return all.sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  } catch {
    return [];
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  await tx('readwrite', (store) => store.delete(id));
}

export interface FlushResult {
  synced: number;
  conflicts: Array<{ code: string; message: string }>;
  stillOffline: boolean;
}

// Sube TODO lo encolado. Se llama al evento 'online' y con el botón manual.
// Una foto que no sube ⇒ seguimos offline: se interrumpe sin desechar nada.
export async function flushQueue(): Promise<FlushResult> {
  const result: FlushResult = { synced: 0, conflicts: [], stillOffline: false };
  const items = await listQueue();
  for (const item of items) {
    try {
      // 1) Fotos: la misma vía de siempre (dest=handover por código/tramo).
      const paths: string[] = [];
      for (const photo of item.photos) {
        const fd = new FormData();
        fd.set('dest', 'handover');
        fd.set('code', item.code);
        fd.set('seg', String(item.segIdx));
        fd.append('photos', photo.blob, photo.name);
        const res = await fetch('/api/admin/vehicles/photos', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`foto ${res.status}`);
        const data = (await res.json()) as { paths: string[] };
        paths.push(...data.paths);
      }
      // 2) El handover en sí.
      const res = await fetch(`/api/admin/segments/${item.segmentId}/handover`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...item.payload, photos: paths }),
      });
      if (res.ok) {
        await removeFromQueue(item.id);
        result.synced++;
      } else if (res.status === 409) {
        // Otro staff cerró ese tramo mientras tanto: el registro queda para
        // revisión, no se descarta evidencia.
        const data = (await res.json().catch(() => ({}))) as { hint?: string };
        item.conflict = data.hint ?? 'El tramo ya no está en el estado esperado.';
        await enqueue(item);
        result.conflicts.push({ code: item.code, message: item.conflict });
      } else {
        throw new Error(`handover ${res.status}`);
      }
    } catch {
      // Sin red todavía: se conservan TODOS los pendientes (y este no marcó
      // ni sincronizó nada a medias — las fotos ya subidas no dañan).
      result.stillOffline = true;
      break;
    }
  }
  return result;
}

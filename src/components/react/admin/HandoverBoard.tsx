// HandoverBoard — la pantalla del patio (ROADMAP Fase 3): agenda de entregas
// y devoluciones del día, con captura de checklist, odómetro, combustible y
// FOTOS DE EVIDENCIA. Mobile-first por diseño: la usa el staff en tablet/
// móvil con una mano — botones ≥44 px, teclado numérico para el odómetro,
// capture="environment" abre la cámara trasera directo y el diálogo es
// full-screen en viewport angosto. Solo español.
import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
import { Badge } from '../../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Toaster, toast } from '../../ui/sonner';
import MoneyInput from '../../ui/money-input';
import DateTimeField from '../../ui/datetime-field';
import { enqueue, flushQueue, listQueue, type QueuedHandover } from '../../../lib/offline-queue';

interface AgendaItem {
  segment_id: number;
  idx: number;
  seg_status: string;
  done_out: boolean;
  done_in: boolean;
  start_at: string;
  end_at: string;
  pickup_zone: string;
  return_zone: string | null;
  booking_id: number;
  code: string;
  booking_status: string;
  customer_name: string | null;
  customer_phone: string | null;
  flight_number: string | null;
  notes: string | null;
  model_name: string;
  plate: string | null;
}

interface ChecklistItem {
  id: string;
  label: string;
  defaultChecked: boolean;
}

const timeFmt = new Intl.DateTimeFormat('es-MX', { timeStyle: 'short', timeZone: 'America/Merida' });
const dateLong = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeZone: 'America/Merida' });

// Combustible en octavos: 0 = E, 8 = F. Botones grandes para dedo.
const FUEL_LABELS = ['E', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞', 'F'];

function todayInMerida(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Merida' }).format(new Date());
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function HandoverBoard() {
  const [date, setDate] = useState(todayInMerida());
  const [pickups, setPickups] = useState<AgendaItem[]>([]);
  const [returns, setReturns] = useState<AgendaItem[]>([]);
  const [checklists, setChecklists] = useState<{ out: ChecklistItem[]; in: ChecklistItem[] }>({ out: [], in: [] });
  const [loading, setLoading] = useState(true);

  // Diálogo activo: {item, kind}
  const [target, setTarget] = useState<{ item: AgendaItem; kind: 'out' | 'in' } | null>(null);
  // Cola offline: capturas esperando red (badge + sincronización).
  const [queued, setQueued] = useState<QueuedHandover[]>([]);
  const [syncing, setSyncing] = useState(false);

  const loadAgenda = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/agenda?date=${d}`);
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { pickups: AgendaItem[]; returns: AgendaItem[] };
      setPickups(data.pickups ?? []);
      setReturns(data.returns ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAgenda(date).catch(() => undefined);
  }, [date, loadAgenda]);

  async function syncQueue(manual = false): Promise<void> {
    setSyncing(true);
    try {
      const result = await flushQueue();
      if (result.synced > 0) toast.success(`${result.synced} captura(s) subida(s)`);
      for (const c of result.conflicts) toast.warning(`${c.code}: ${c.message} (queda para revisión)`);
      if (result.stillOffline && manual) toast.error('Sigue sin haber conexión');
      setQueued(await listQueue());
      if (result.synced > 0) loadAgenda(date).catch(() => undefined);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    listQueue().then(setQueued).catch(() => undefined);
    const onOnline = () => {
      toast.info('Conexión recuperada — subiendo capturas…');
      syncQueue().catch(() => undefined);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Checklists configurados en Ajustes (defaults del servidor si no hay).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/handover-config');
        if (res.ok) {
          const data = (await res.json()) as { checklists: { out: ChecklistItem[]; in: ChecklistItem[] } };
          setChecklists(data.checklists);
        }
      } catch {
        // sin configuración: el diálogo muestra el mínimo (foto+odómetro)
      }
    })();
  }, []);

  const pendingOut = pickups.filter((p) => !p.done_out).length;
  const pendingIn = returns.filter((p) => !p.done_in).length;

  return (
    <div className="space-y-5">
      <Toaster />

      {/* Barra de fecha: botones gordos para el pulgar, un día antes/después. */}
      <div className="flex flex-wrap items-center gap-2" data-tour="entregas-fecha">
        <Button variant="outline" size="lg" className="h-12 w-12 p-0 text-xl" aria-label="Día anterior"
          onClick={() => setDate(shiftDate(date, -1))}>
          ‹
        </Button>
        <DateTimeField
          value={date}
          onChange={(v) => v && setDate(v)}
          className="w-auto"
          triggerClassName="h-12 px-4 text-base font-medium"
          ariaLabel="Fecha de la agenda"
          placeholder="Hoy"
        />
        <Button variant="outline" size="lg" className="h-12 w-12 p-0 text-xl" aria-label="Día siguiente"
          onClick={() => setDate(shiftDate(date, 1))}>
          ›
        </Button>
        <Button variant={date === todayInMerida() ? 'default' : 'secondary'} size="lg" className="h-12"
          onClick={() => setDate(todayInMerida())}>
          Hoy
        </Button>
        <p className="ml-auto text-sm text-muted-foreground">{dateLong.format(new Date(`${date}T12:00:00`))}</p>
      </div>

      {queued.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            📡 <strong>{queued.length}</strong> captura(s) sin subir
            {queued.some((q) => q.conflict) && ' · alguna requiere revisión'}
          </p>
          <Button variant="outline" size="sm" disabled={syncing} onClick={() => syncQueue(true)}>
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2" data-tour="entregas-contadores">
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Entregas pendientes</p>
          <p className="text-3xl font-bold text-brand">{pendingOut}</p>
          <p className="text-xs text-muted-foreground">{pickups.length} en el día</p>
        </div>
        <div className="rounded-xl border bg-background p-4">
          <p className="text-sm text-muted-foreground">Devoluciones pendientes</p>
          <p className="text-3xl font-bold text-amber-600">{pendingIn}</p>
          <p className="text-xs text-muted-foreground">{returns.length} en el día</p>
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Cargando agenda…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <AgendaColumn
            title="Entregas"
            items={pickups}
            kind="out"
            onOpen={(item) => setTarget({ item, kind: 'out' })}
          />
          <AgendaColumn
            title="Devoluciones"
            items={returns}
            kind="in"
            onOpen={(item) => setTarget({ item, kind: 'in' })}
          />
        </div>
      )}

      {target && (
        <HandoverDialog
          item={target.item}
          kind={target.kind}
          checklist={checklists[target.kind]}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            loadAgenda(date).catch(() => undefined);
            listQueue().then(setQueued).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}

function AgendaColumn({
  title,
  items,
  kind,
  onOpen,
}: {
  title: string;
  items: AgendaItem[];
  kind: 'out' | 'in';
  onOpen: (item: AgendaItem) => void;
}) {
  return (
    <section className="space-y-3" data-tour="entregas-tarjeta">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title} ({items.length})</h2>
      {items.length === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Sin {title.toLowerCase()} en este día.
        </p>
      )}
      {items.map((item) => {
        const done = kind === 'out' ? item.done_out : item.done_in;
        const at = kind === 'out' ? item.start_at : item.end_at;
        return (
          <div
            key={`${item.segment_id}-${kind}`}
            className={`rounded-xl border bg-background p-4 ${done ? 'opacity-60' : ''}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-2xl font-bold leading-none">{timeFmt.format(new Date(at))}</p>
                <p className="mt-1.5 truncate text-base font-semibold">{item.customer_name ?? '—'}</p>
                <p className="text-sm text-muted-foreground">
                  {item.model_name}
                  {item.plate && (
                    <span className="ml-1.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider text-slate-700">
                      {item.plate}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {kind === 'out' ? item.pickup_zone : item.return_zone ?? item.pickup_zone}
                  {item.flight_number ? ` · ✈ ${item.flight_number}` : ''}
                </p>
                {item.notes && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">📝 {item.notes}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
                {item.customer_phone && (
                  <a
                    href={`tel:${item.customer_phone.replace(/[^\d+]/g, '')}`}
                    className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
                  >
                    📞 Llamar
                  </a>
                )}
              </div>
            </div>
            {done ? (
              <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                ✓ {kind === 'out' ? 'Entregado' : 'Devuelto'} — captura registrada
              </p>
            ) : (
              <Button
                size="lg"
                className={`mt-3 h-12 w-full text-base ${kind === 'out' ? '' : 'bg-amber-600 hover:bg-amber-700'}`}
                onClick={() => onOpen(item)}
              >
                {kind === 'out' ? '🚗 Entregar auto' : '🔁 Recoger auto'}
              </Button>
            )}
          </div>
        );
      })}
    </section>
  );
}

function HandoverDialog({
  item,
  kind,
  checklist,
  onClose,
  onDone,
}: {
  item: AgendaItem;
  kind: 'out' | 'in';
  checklist: ChecklistItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [checks, setChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(checklist.map((c) => [c.id, c.defaultChecked])),
  );
  const [odometer, setOdometer] = useState('');
  const [fuel, setFuel] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  // path = ya subida al servidor · file = blob local (offline, preview
  // objectURL) que viajará en la cola o se subirá al confirmar.
  const [photos, setPhotos] = useState<Array<{ path?: string; file?: File; url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const at = kind === 'out' ? item.start_at : item.end_at;
  const odometerValid = odometer.trim() !== '' && Number(odometer) >= 0;
  const canSave = odometerValid && fuel !== null && photos.length > 0 && !uploading && !saving;

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // permitir re-elegir el mismo archivo
    if (files.length === 0) return;

    // Sin red: los blobs se quedan locales (preview inmediata); subirán al
    // confirmar (si hay red) o viajarán en la cola offline.
    if (!navigator.onLine) {
      setPhotos((prev) => [...prev, ...files.map((f) => ({ file: f, url: URL.createObjectURL(f) }))]);
      toast.info('Sin conexión: la foto se guardó en la tablet');
      return;
    }

    setUploading(true);
    try {
      const form = new FormData();
      form.set('dest', 'handover');
      form.set('code', item.code);
      form.set('seg', String(item.idx));
      for (const f of files) form.append('photos', f);
      const res = await fetch('/api/admin/vehicles/photos', { method: 'POST', body: form });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error === 'too_large' ? 'Foto demasiado grande (máx 10 MB)' : 'No se pudo subir la foto');
        return;
      }
      const data = (await res.json()) as { paths: string[] };
      setPhotos((prev) => [...prev, ...data.paths.map((p, i) => ({ path: p, url: p }))]);
    } catch {
      // la red cayó a media subida: blobs locales como fallback
      setPhotos((prev) => [...prev, ...files.map((f) => ({ file: f, url: URL.createObjectURL(f) }))]);
      toast.info('Sin conexión: la foto se guardó en la tablet');
    } finally {
      setUploading(false);
    }
  }

  async function uploadPendingFiles(): Promise<string[]> {
    // Sube las fotos que sólo existen como blob local (red disponible).
    const pending = photos.filter((p) => p.file);
    if (pending.length === 0) return [];
    const form = new FormData();
    form.set('dest', 'handover');
    form.set('code', item.code);
    form.set('seg', String(item.idx));
    for (const p of pending) form.append('photos', p.file!);
    const res = await fetch('/api/admin/vehicles/photos', { method: 'POST', body: form });
    if (res.status === 401) {
      window.location.href = '/admin/login';
      throw new Error('unauthorized');
    }
    if (!res.ok) throw new Error('upload');
    const data = (await res.json()) as { paths: string[] };
    return data.paths;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        kind,
        odometer: Number(odometer),
        fuel: fuel!,
        checklist: checks,
        ...(notes ? { notes } : {}),
      };

      // SIN RED: el handover completo (payload + blobs) viaja a la cola de
      // IndexedDB; subirá solo al reconectar.
      if (!navigator.onLine) {
        await enqueue({
          id: `${item.segment_id}-${Date.now().toString(36)}`,
          segmentId: item.segment_id,
          code: item.code,
          segIdx: item.idx,
          kind,
          payload,
          photos: photos.filter((p) => p.file).map((p, i) => ({ name: p.file!.name || `foto-${i + 1}.jpg`, blob: p.file! })),
          queuedAt: new Date().toISOString(),
        });
        toast.info(`${item.code}: guardado sin conexión — se subirá al reconectar`);
        onDone();
        return;
      }

      const uploaded = await uploadPendingFiles();
      const res = await fetch(`/api/admin/segments/${item.segment_id}/handover`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, photos: [...photos.filter((p) => p.path).map((p) => p.path!), ...uploaded] }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        toast.success(`${item.code}: ${kind === 'out' ? 'auto entregado' : 'auto devuelto'}`);
        const data = (await res.json().catch(() => ({}))) as {
          serviceDue?: { kmSinceService: number; intervalKm: number } | null;
        };
        if (data.serviceDue) {
          toast.warning(
            `🔧 La unidad recorrió ${data.serviceDue.kmSinceService.toLocaleString('es-MX')} km desde su último servicio (intervalo ${data.serviceDue.intervalKm.toLocaleString('es-MX')}): márcala en Flota cuando vaya a taller.`,
            { duration: 8000 },
          );
        }
        onDone();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
      toast.error(data.hint ?? 'No se pudo registrar');
    } catch {
      // la red cayó a media operación: a la cola (los blobs siguen locales)
      toast.info('Se perdió la conexión: intentando guardar localmente…');
      try {
        await enqueue({
          id: `${item.segment_id}-${Date.now().toString(36)}`,
          segmentId: item.segment_id,
          code: item.code,
          segIdx: item.idx,
          kind,
          payload: {
            kind,
            odometer: Number(odometer),
            fuel: fuel ?? 0,
            checklist: checks,
            ...(notes ? { notes } : {}),
          },
          photos: photos.filter((p) => p.file).map((p, i) => ({ name: p.file!.name || `foto-${i + 1}.jpg`, blob: p.file! })),
          queuedAt: new Date().toISOString(),
        });
        toast.info(`${item.code}: guardado sin conexión — se subirá al reconectar`);
        onDone();
      } catch {
        toast.error('No se pudo registrar (ni localmente)');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* max-w-full + h-dvh en angosto: full-screen para el patio. */}
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-lg max-sm:max-w-full max-sm:h-[100dvh] max-sm:rounded-none max-sm:border-0 sm:max-h-[92vh]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <Badge variant={kind === 'out' ? 'default' : 'warning'}>
              {kind === 'out' ? 'Entrega' : 'Devolución'}
            </Badge>
            <span className="font-mono text-sm font-normal text-muted-foreground">{item.code}</span>
          </DialogTitle>
          <DialogDescription>
            {timeFmt.format(new Date(at))} · {item.model_name}
            {item.plate ? ` · ${item.plate}` : ''} · {item.customer_name}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-5">
          {checklist.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Checklist</legend>
              {checklist.map((c) => (
                <label
                  key={c.id}
                  className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 has-[:checked]:border-brand has-[:checked]:bg-brand-soft/40"
                >
                  <input
                    type="checkbox"
                    className="h-6 w-6 accent-[#0e7490]"
                    checked={checks[c.id] ?? false}
                    onChange={(e) => setChecks({ ...checks, [c.id]: e.target.checked })}
                  />
                  <span className="text-base">{c.label}</span>
                </label>
              ))}
            </fieldset>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="ho-odo" className="text-sm font-semibold">Odómetro (km)</label>
              <MoneyInput
                id="ho-odo"
                inputMode="numeric"
                min={0}
                step={1}
                required
                placeholder="45000"
                prefix=""
                suffix="km"
                className="h-14 text-2xl tabular-nums"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">Combustible</p>
              <div className="grid grid-cols-9 gap-0.5" role="radiogroup" aria-label="Nivel de combustible">
                {FUEL_LABELS.map((label, level) => (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={fuel === level}
                    className={`h-14 rounded-md border text-xs font-semibold ${fuel === level ? 'border-brand bg-brand text-white' : 'bg-background hover:bg-accent'}`}
                    onClick={() => setFuel(level)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-semibold">
              Fotos de evidencia <span className="font-normal text-muted-foreground">(mínimo 1)</span>
            </p>
            {/* capture="environment": en móvil abre la cámara trasera directo. */}
            <label
              htmlFor="ho-photos"
              className="flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm hover:bg-accent"
            >
              {uploading ? '⏳ Subiendo…' : '📷 Tomar / elegir fotos'}
            </label>
            <input
              id="ho-photos"
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              className="sr-only"
              onChange={onPickFiles}
            />
            {photos.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {photos.map((p, i) => (
                  <div key={p.url} className="group relative">
                    <img src={p.url} alt={`Evidencia ${i + 1}`} className="h-20 w-full rounded-md object-cover" />
                    {p.file && (
                      <span className="absolute bottom-1 left-1 rounded bg-amber-500/90 px-1 text-[9px] font-bold text-white">
                        LOCAL
                      </span>
                    )}
                    <button
                      type="button"
                      aria-label={`Quitar evidencia ${i + 1}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                      onClick={() => setPhotos(photos.filter((x) => x.url !== p.url))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="ho-notes" className="text-sm font-semibold">Observaciones</label>
            <Textarea
              id="ho-notes"
              rows={2}
              placeholder={kind === 'out' ? 'ej. cliente pidió silla de bebé, se le entregó…' : 'ej. raya nueva en defensa derecha, cliente informado…'}
              value={notes}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            />
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button type="submit" size="lg" disabled={!canSave} className="h-14 w-full text-base">
              {saving ? 'Guardando…' : kind === 'out' ? 'Confirmar entrega' : 'Confirmar devolución'}
            </Button>
            <Button type="button" variant="outline" size="lg" className="h-12 w-full" onClick={onClose}>
              Cancelar
            </Button>
            {!photos.length && <p className="text-center text-xs text-muted-foreground">La foto de evidencia es obligatoria.</p>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

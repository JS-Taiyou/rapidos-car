// PointsManager — gestión de puntos de entrega/recogida (/admin/puntos):
// lista con tarifa opcional y activo, editor con MAPA (Leaflet + tiles de
// OpenStreetMap, sin API key): clic o arrastre del pin fija la ubicación.
// Solo español.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
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

interface Point {
  id: number;
  key: string;
  name: string;
  feeCents: number | null;
  lat: number | null;
  lng: number | null;
  active: boolean;
  sortOrder: number;
}

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const MERIDA: L.LatLngExpression = [20.9674, -89.5926];

export default function PointsManager() {
  const [points, setPoints] = useState<Point[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Point | null>(null);
  const [form, setForm] = useState({ key: '', name: '', fee: '' });
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Point | null>(null);

  async function load() {
    const res = await fetch('/api/admin/points');
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const data = (await res.json()) as { points: Point[] };
    setPoints(data.points ?? []);
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  function openCreate() {
    setEditing(null);
    setForm({ key: '', name: '', fee: '' });
    setPin(null);
    setDialogOpen(true);
  }

  function openEdit(p: Point) {
    setEditing(p);
    setForm({ key: p.key, name: p.name, fee: p.feeCents === null ? '' : String(p.feeCents / 100) });
    setPin(p.lat !== null && p.lng !== null ? { lat: p.lat, lng: p.lng } : null);
    setDialogOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        key: form.key.trim(),
        name: form.name.trim(),
        feeCents: form.fee.trim() === '' ? null : Math.round(Number(form.fee) * 100),
        location: pin,
      };
      const res = await fetch(editing ? `/api/admin/points/${editing.id}` : '/api/admin/points', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        // PATCH parcial: sin key en edición (es identificador estable).
        body: JSON.stringify(editing ? { name: body.name, feeCents: body.feeCents, location: body.location } : body),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        toast.success(editing ? 'Punto actualizado' : 'Punto creado');
        setDialogOpen(false);
        await load();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; key?: string; issues?: Array<{ message: string }> };
      if (data.error === 'duplicate_key') {
        toast.error(`La clave "${data.key}" ya existe`);
      } else if (data.error === 'validation') {
        toast.error(data.issues?.[0]?.message ?? 'Revisa los campos');
      } else {
        toast.error('No se pudo guardar');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: Point) {
    const res = await fetch(`/api/admin/points/${p.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !p.active }),
    });
    if (res.ok) await load();
  }

  async function remove() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/admin/points/${deleteTarget.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Punto eliminado');
      setDeleteTarget(null);
      await load();
      return;
    }
    toast.error('No se pudo eliminar');
  }

  return (
    <div className="space-y-6">
      <Toaster />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Los puntos activos aparecen en el wizard y en la captura manual. La tarifa se cobra por
          entrega y por recogida cuando son puntos distintos.
        </p>
        <Button onClick={openCreate}>+ Nuevo punto</Button>
      </div>

      <div className="rounded-xl border bg-background">
        {points.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">Sin puntos registrados.</p>
        ) : (
          <ul className="divide-y">
            {points.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {p.name}
                    {!p.active && <Badge variant="secondary" className="ml-2">inactivo</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-mono">{p.key}</span>
                    {p.lat !== null && p.lng !== null && ` · 📍 ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">
                  {p.feeCents === null ? 'Gratis' : moneyFmt.format(p.feeCents / 100)}
                </span>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[#0e7490]"
                  checked={p.active}
                  onChange={() => toggleActive(p)}
                  aria-label={`Activo ${p.name}`}
                />
                <Button size="sm" variant="outline" onClick={() => openEdit(p)}>
                  Editar
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(p)}>
                  Eliminar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Editar ${editing.name}` : 'Nuevo punto'}</DialogTitle>
            <DialogDescription>
              Ubica el pin en el mapa (clic o arrastre) y captura la tarifa — vacía = gratuito.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pt-name">Nombre</Label>
                <Input id="pt-name" placeholder="Aeropuerto, hotel, oficina…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pt-key">Clave (URL/API)</Label>
                <Input
                  id="pt-key"
                  className="font-mono"
                  placeholder="aeropuerto"
                  disabled={!!editing}
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                />
                {editing && <p className="text-xs text-muted-foreground">La clave no cambia (reservas históricas la referencian).</p>}
              </div>
            </div>
            <div className="max-w-[12rem] space-y-1.5">
              <Label htmlFor="pt-fee">Tarifa de servicio (MXN)</Label>
              <Input id="pt-fee" type="number" min={0} step="0.01" placeholder="Gratis" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} />
            </div>

            <MapPicker pin={pin} onChange={setPin} />

            <p className="text-xs text-muted-foreground">
              {pin ? `📍 ${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}` : 'Sin ubicación capturada (opcional).'}
            </p>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Eliminar “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              Las reservas históricas conservan su clave; el punto deja de ofrecerse de inmediato.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Volver
            </Button>
            <Button variant="destructive" onClick={remove}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Mapa Leaflet + tiles de OpenStreetMap (gratis, sin key). Clic = mover pin;
// arrastre = mover pin. Atribución obligatoria incluida.
function MapPicker({ pin, onChange }: { pin: { lat: number; lng: number } | null; onChange: (p: { lat: number; lng: number } | null) => void }) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current).setView(pin ?? MERIDA, pin ? 14 : 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    const icon = L.divIcon({
      className: '',
      html: '<svg width="30" height="30" viewBox="0 0 24 24" fill="#0e7490" stroke="white" stroke-width="1"><path d="M12 21s-7-5.3-7-11a7 7 0 1 1 14 0c0 5.7-7 11-7 11Z"/></svg>',
      iconSize: [30, 30],
      iconAnchor: [15, 28],
    });
    const setMarker = (latlng: L.LatLng) => {
      if (markerRef.current) {
        markerRef.current.setLatLng(latlng);
      } else {
        markerRef.current = L.marker(latlng, { draggable: true, icon }).addTo(map);
        markerRef.current.on('dragend', () => {
          const p = markerRef.current!.getLatLng();
          onChange({ lat: p.lat, lng: p.lng });
        });
      }
      onChange({ lat: latlng.lat, lng: latlng.lng });
    };
    map.on('click', (e) => setMarker(e.latlng));
    if (pin) setMarker(L.latLng(pin.lat, pin.lng));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={divRef}
      className="h-64 w-full overflow-hidden rounded-xl border"
      role="application"
      aria-label="Mapa para elegir ubicación"
    />
  );
}

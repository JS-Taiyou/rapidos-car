// ReservationsBoard — pipeline de reservaciones (spec §4.3): lista/calendario,
// transiciones de estado, captura manual (renta) y bloqueos de taller
// (kind='block': misma tabla, misma constraint — §2.10). Solo español.
//
// Nota de implementación: el diálogo de captura usa estado controlado +
// manualBookingSchema.safeParse al enviar (mismo contrato zod que el
// endpoint, §2.12) en lugar de react-hook-form: el schema anida customer
// opcional con refines por kind y el binding manual es más claro aquí.
import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Toaster, toast } from '../../ui/sonner';
import { manualBookingSchema } from '../../../lib/validation';

interface AdminBooking {
  id: number;
  code: string;
  kind: 'rental' | 'block';
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  plate: string;
  model_name: string;
  model_slug: string;
  period_start: string;
  period_end: string;
  total_cents: number;
  pickup_zone: string;
  notes: string | null;
}

interface UnitOption {
  id: number;
  plate: string;
  label: string;
}

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dtFmt = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Merida',
});

const STATUS_BADGE: Record<string, 'default' | 'success' | 'secondary' | 'destructive' | 'warning'> = {
  quoted: 'warning',
  confirmed: 'default',
  active: 'success',
  completed: 'secondary',
  cancelled: 'destructive',
};

// Etiquetas ES de los estados del pipeline (los valores crudos de la BD no
// se tocan — solo la presentación).
const STATUS_LABEL: Record<string, string> = {
  quoted: 'Cotizada',
  confirmed: 'Confirmada',
  active: 'Activa',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

// Botones por fila derivados del status (las transiciones las valida el
// servidor con su propio mapa — esto es solo UX).
const ACTIONS: Record<string, Array<{ to: string; label: string; danger?: boolean }>> = {
  quoted: [
    { to: 'confirmed', label: 'Confirmar' },
    { to: 'cancelled', label: 'Cancelar', danger: true },
  ],
  confirmed: [
    { to: 'active', label: 'Iniciar renta' },
    { to: 'cancelled', label: 'Cancelar', danger: true },
  ],
  active: [{ to: 'completed', label: 'Completar' }],
  completed: [],
  cancelled: [],
};

const emptyForm = {
  kind: 'rental' as 'rental' | 'block',
  modelSlug: '',
  vehicleId: '',
  start: '',
  end: '',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  flightNumber: '',
  notes: '',
};

export default function ReservationsBoard() {
  const [bookings, setBookings] = useState<AdminBooking[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [models, setModels] = useState<Array<{ slug: string; name: string }>>([]);
  const [status, setStatus] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [cancelTarget, setCancelTarget] = useState<AdminBooking | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // En vista calendario, el rango de fetch se deriva del mes visible.
  const effectiveFrom =
    view === 'calendar'
      ? `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`
      : from;
  const effectiveTo =
    view === 'calendar'
      ? new Date(month.getFullYear(), month.getMonth() + 1, 0).toISOString().slice(0, 10)
      : to;

  const loadBookings = useCallback(
    async (signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (effectiveFrom) params.set('from', effectiveFrom);
      if (effectiveTo) params.set('to', effectiveTo);
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/admin/bookings?${params.toString()}`, { signal });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as { bookings: AdminBooking[] };
      setBookings(data.bookings ?? []);
    },
    [effectiveFrom, effectiveTo, status],
  );

  useEffect(() => {
    const ac = new AbortController();
    loadBookings(ac.signal).catch(() => undefined);
    return () => ac.abort();
  }, [loadBookings]);

  // Catálogo (modelos para el select de captura, unidades para el calendario
  // y el bloqueo): viene de /api/admin/vehicles, NO de las reservaciones
  // cargadas (si el filtro no trae reservaciones, el select quedaría vacío).
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/vehicles');
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        models: Array<{ slug: string; name: string; active: boolean; units: Array<{ id: number; plate: string; status: string }> }>;
      };
      setModels((data.models ?? []).filter((m) => m.active).map((m) => ({ slug: m.slug, name: m.name })));
      setUnits(
        (data.models ?? []).flatMap((m) =>
          m.units.filter((u) => u.status === 'active').map((u) => ({ ...u, label: `${u.plate} — ${m.name}` })),
        ),
      );
    })().catch(() => undefined);
  }, []);

  async function patchStatus(booking: AdminBooking, to: string) {
    const res = await fetch(`/api/admin/bookings/${booking.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: to }),
    });
    if (res.ok) {
      // Re-fetch simple tras cada mutación, sin optimistic UI: el pipeline
      // tiene reglas que el servidor valida; una query y listo.
      await loadBookings();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; from?: string; to?: string };
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    toast.error(
      data.error === 'invalid_transition'
        ? `Transición inválida: ${data.from} → ${data.to}`
        : 'No se pudo actualizar',
    );
  }

  async function submitCapture(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErrors({});
    try {
      const candidate = {
        kind: form.kind,
        modelSlug: form.modelSlug || undefined,
        vehicleId: form.vehicleId ? Number(form.vehicleId) : undefined,
        start: form.start,
        end: form.end,
        pickupZone: 'office',
        customer:
          form.kind === 'rental'
            ? {
                name: form.customerName,
                email: form.customerEmail || `${form.customerPhone.replace(/\D/g, '')}@placeholder.local`,
                phone: form.customerPhone,
                flightNumber: form.flightNumber || undefined,
              }
            : undefined,
        notes: form.notes || undefined,
      };
      const parsed = manualBookingSchema.safeParse(candidate);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const path = issue.path.join('.');
          if (!errors[path]) errors[path] = issue.message;
        }
        setFormErrors(errors);
        return;
      }
      const body: Record<string, unknown> = {
        ...parsed.data,
        start: new Date(form.start).toISOString(),
        end: new Date(form.end).toISOString(),
      };
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        toast.success('Guardada');
        setCaptureOpen(false);
        setForm(emptyForm);
        await loadBookings();
        return;
      }
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      toast.error(res.status === 409 ? 'Solape con otra reservación de esa unidad' : 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  const statusFilters: Array<{ value: string; label: string }> = [
    { value: 'all', label: 'Todos' },
    { value: 'quoted', label: STATUS_LABEL.quoted },
    { value: 'confirmed', label: STATUS_LABEL.confirmed },
    { value: 'active', label: STATUS_LABEL.active },
    { value: 'completed', label: STATUS_LABEL.completed },
    { value: 'cancelled', label: STATUS_LABEL.cancelled },
  ];

  return (
    <div className="space-y-4">
      <Toaster />

      <div className="flex flex-wrap items-end gap-3">
        {view === 'list' && (
          <>
            <div className="space-y-1">
              <Label htmlFor="rb-from">Desde</Label>
              <Input id="rb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rb-to">Hasta</Label>
              <Input id="rb-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        )}
        {view === 'calendar' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
              ‹
            </Button>
            <span className="text-sm font-medium capitalize">
              {new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)}
            </span>
            <Button variant="outline" size="sm" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
              ›
            </Button>
          </div>
        )}
        <div className="w-44 space-y-1">
          <Label htmlFor="rb-status">Estado</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="rb-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusFilters.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-1">
          <Button variant={view === 'list' ? 'default' : 'outline'} size="sm" onClick={() => setView('list')}>
            Lista
          </Button>
          <Button variant={view === 'calendar' ? 'default' : 'outline'} size="sm" onClick={() => setView('calendar')}>
            Calendario
          </Button>
        </div>
        <Button className="ml-auto" onClick={() => setCaptureOpen(true)}>
          + Capturar reservación
        </Button>
      </div>

      {view === 'list' ? (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Unidad</TableHead>
                <TableHead>Periodo</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    Sin reservaciones para estos filtros.
                  </TableCell>
                </TableRow>
              )}
              {bookings.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs">{b.code}</TableCell>
                  <TableCell>
                    {/* Render condicional: los blocks no tienen customer_*. */}
                    {b.kind === 'block' ? (
                      <span className="font-medium">
                        BLOQUEO{b.notes ? <span className="block text-xs text-muted-foreground">{b.notes}</span> : null}
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">{b.customer_name}</span>
                        <span className="block text-xs text-muted-foreground">{b.customer_phone}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{b.plate}</span>
                    <span className="block text-xs text-muted-foreground">{b.model_name}</span>
                  </TableCell>
                  <TableCell className="text-xs">
                    {dtFmt.format(new Date(b.period_start))}
                    <br />
                    {dtFmt.format(new Date(b.period_end))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.kind === 'block' ? '—' : moneyFmt.format(b.total_cents / 100)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[b.status] ?? 'secondary'}>
                      {STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(ACTIONS[b.status] ?? []).map((action) => (
                        <Button
                          key={action.to}
                          size="sm"
                          variant={action.danger ? 'destructive' : 'outline'}
                          onClick={() =>
                            action.danger ? setCancelTarget(b) : patchStatus(b, action.to)
                          }
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <CalendarView bookings={bookings} units={units} month={month} />
      )}

      {/* Confirmación de cancelación */}
      <Dialog open={cancelTarget !== null} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Cancelar {cancelTarget?.code}?</DialogTitle>
            <DialogDescription>
              La unidad queda libre automáticamente al cancelar. El historial se conserva.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Volver
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (cancelTarget) patchStatus(cancelTarget, 'cancelled');
                setCancelTarget(null);
              }}
            >
              Cancelar reservación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Captura manual (renta) y bloqueo de taller (block): mismo endpoint */}
      <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Capturar reservación</DialogTitle>
            <DialogDescription>
              Renta de teléfono/walk-in o bloqueo de taller. La unidad se asigna en el servidor.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitCapture} className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={form.kind === 'rental' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setForm({ ...form, kind: 'rental' })}
              >
                Renta
              </Button>
              <Button
                type="button"
                variant={form.kind === 'block' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setForm({ ...form, kind: 'block' })}
              >
                Bloqueo (taller)
              </Button>
            </div>

            {form.kind === 'block' ? (
              <div className="space-y-1.5">
                <Label htmlFor="cap-unit">Unidad (placa)</Label>
                <Select value={form.vehicleId} onValueChange={(v) => setForm({ ...form, vehicleId: v })}>
                  <SelectTrigger id="cap-unit">
                    <SelectValue placeholder="Elige la placa" />
                  </SelectTrigger>
                  <SelectContent>
                    {units.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.vehicleId && <p className="text-xs text-destructive">{formErrors.vehicleId}</p>}
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="cap-model">Modelo</Label>
                  <Select value={form.modelSlug} onValueChange={(v) => setForm({ ...form, modelSlug: v })}>
                    <SelectTrigger id="cap-model">
                      <SelectValue placeholder="Elige el modelo" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Catálogo de flota (solo modelos activos), no las
                          reservaciones filtradas. */}
                      {models.map((m) => (
                        <SelectItem key={m.slug} value={m.slug}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {formErrors.modelSlug && <p className="text-xs text-destructive">{formErrors.modelSlug}</p>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="cap-name">Nombre</Label>
                    <Input id="cap-name" value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
                    {formErrors['customer.name'] && <p className="text-xs text-destructive">{formErrors['customer.name']}</p>}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="cap-phone">Teléfono</Label>
                    <Input id="cap-phone" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
                    {formErrors['customer.phone'] && <p className="text-xs text-destructive">{formErrors['customer.phone']}</p>}
                  </div>
                </div>
              </>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cap-start">Inicio</Label>
                <Input id="cap-start" type="datetime-local" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
                {formErrors.start && <p className="text-xs text-destructive">{formErrors.start}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cap-end">Fin</Label>
                <Input id="cap-end" type="datetime-local" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
                {formErrors.end && <p className="text-xs text-destructive">{formErrors.end}</p>}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cap-notes">Notas {form.kind === 'block' ? '(motivo del bloqueo)' : '(opcionales)'}</Label>
              <Input id="cap-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCaptureOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Vista calendario A MANO (columnas = días del mes, filas = unidades): las
// barras se posicionan por porcentaje dentro de la fila — FullCalendar pesa
// ~300 kB y cobra uso comercial; aquí basta lectura visual.
function CalendarView({
  bookings,
  units,
  month,
}: {
  bookings: AdminBooking[];
  units: UnitOption[];
  month: Date;
}) {
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const monthMs = daysInMonth * 86_400_000;

  // Clampa a los bordes del mes visible: una renta que empieza el mes
  // anterior NO puede producir anchos negativos.
  function bar(b: AdminBooking): { leftPct: number; widthPct: number } | null {
    const s = new Date(b.period_start);
    const e = new Date(b.period_end);
    if (s >= monthEnd || e <= monthStart) return null;
    const cs = Math.max(s.getTime(), monthStart.getTime());
    const ce = Math.min(e.getTime(), monthEnd.getTime());
    return {
      leftPct: ((cs - monthStart.getTime()) / monthMs) * 100,
      widthPct: (Math.max(ce - cs, 86_400_000 * 0.25) / monthMs) * 100,
    };
  }

  const barColor: Record<string, string> = {
    confirmed: 'bg-sky-200 text-sky-900',
    active: 'bg-emerald-200 text-emerald-900',
    completed: 'bg-gray-200 text-gray-700',
    cancelled: 'bg-red-200 text-red-900 line-through',
    quoted: 'bg-amber-200 text-amber-900',
  };

  return (
    <div className="overflow-x-auto rounded-xl border p-3">
      <div className="min-w-[900px]">
        {/* Encabezado de días */}
        <div className="flex items-end">
          <div className="w-[140px] shrink-0" />
          <div className="relative h-5 flex-1">
            {Array.from({ length: daysInMonth }, (_, i) => (
              <span
                key={i}
                className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground"
                style={{ left: `${((i + 0.5) / daysInMonth) * 100}%` }}
              >
                {i + 1}
              </span>
            ))}
          </div>
        </div>
        {units.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay unidades activas registradas (administra la flota en /admin/flota).
          </p>
        )}
        {units.map((unit) => (
          <div key={unit.id} className="mt-1 flex items-center">
            <div className="w-[140px] shrink-0 truncate pr-2 font-mono text-xs">{unit.plate}</div>
            <div className="relative h-7 flex-1 rounded bg-muted/50">
              {bookings
                .filter((b) => b.plate === unit.plate)
                .map((b) => {
                  const dims = bar(b);
                  if (!dims) return null;
                  return (
                    <div
                      key={b.id}
                      className={`absolute top-0.5 h-6 truncate rounded px-1 text-[10px] leading-6 ${
                        b.kind === 'block'
                          ? 'bg-[repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_4px,#cbd5e1_4px,#cbd5e1_8px)] text-gray-700'
                          : barColor[b.status] ?? 'bg-gray-200'
                      }`}
                      style={{ left: `${dims.leftPct}%`, width: `${dims.widthPct}%` }}
                      title={`${b.code} · ${b.customer_name ?? 'BLOQUEO'} · ${b.status}`}
                    >
                      {b.kind === 'block' ? '🔧 ' : ''}
                      {b.code}
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

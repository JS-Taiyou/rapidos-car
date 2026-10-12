// ReservationsBoard — pipeline de reservaciones (spec §4.3): lista/calendario,
// transiciones de estado, captura manual (renta) y bloqueos de taller
// (kind='block': misma tabla, misma constraint — §2.10). Solo español.
//
// Nota de implementación: el diálogo de captura usa estado controlado +
// manualBookingSchema.safeParse al enviar (mismo contrato zod que el
// endpoint, §2.12) en lugar de react-hook-form: el schema anida customer
// opcional con refines por kind y el binding manual es más claro aquí.
import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Textarea } from '../../ui/textarea';
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
  pricing?: {
    source?: string;
    reason?: string;
    editedBy?: string;
    discount?: { kind: string; value?: number; cents?: number; reason?: string };
  } | null;
  extras: Array<{ name: string; qty: number }>;
  requested?: {
    channel?: string;
    model?: { slug: string; name: string };
    start?: string;
    end?: string;
    extras?: Array<{ name: string; qty: number }>;
    totalCents?: number;
    reason?: string;
  } | null;
  // Línea de tiempo de tramos (migración 006): una renta puede cambiar de
  // vehículo a mitad. Los campos plate/model_name/period_* de arriba son la
  // compat del PRIMER tramo.
  segments?: Array<{
    id: number;
    idx: number;
    status: string;
    model_slug: string;
    model_name: string;
    plate: string | null;
    period_start: string;
    period_end: string;
    total_cents: number;
  }>;
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

// Fecha corta tipo "01/oct" para los bullets del cuadro original.
function fmtShort(iso: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', timeZone: 'America/Merida' })
    .format(new Date(iso))
    .replace('.', '');
}

function datesChanged(b: AdminBooking): boolean {
  return (
    new Date(b.requested?.start ?? b.period_start).getTime() !== new Date(b.period_start).getTime() ||
    new Date(b.requested?.end ?? b.period_end).getTime() !== new Date(b.period_end).getTime()
  );
}

// Unión de extras entre pedido original y estado actual (para ❌/✅ por extra).
function unionExtras(b: AdminBooking): string[] {
  const names = new Set<string>();
  for (const e of b.requested?.extras ?? []) names.add(e.name);
  for (const e of b.extras ?? []) names.add(e.name);
  return Array.from(names);
}

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

interface ExtraCatalogItem {
  id: number;
  name: string;
  priceCents: number;
  per: 'day' | 'rental';
  active: boolean;
}

// Selección de extras en el diálogo: precio en PESOS (editable).
type ExtrasSel = Record<number, { qty: number; price: number }>;

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
  const [extrasCatalog, setExtrasCatalog] = useState<ExtraCatalogItem[]>([]);
  const [extrasSel, setExtrasSel] = useState<ExtrasSel>({});
  const [rateOverride, setRateOverride] = useState('');
  const [discountKind, setDiscountKind] = useState<'none' | 'pct' | 'amount'>('none');
  const [discountValue, setDiscountValue] = useState('');
  const [priceReason, setPriceReason] = useState('');
  // Reprice de una reserva existente
  const [priceTarget, setPriceTarget] = useState<AdminBooking | null>(null);
  const [repriceRate, setRepriceRate] = useState('');
  const [repriceKind, setRepriceKind] = useState<'none' | 'pct' | 'amount'>('none');
  const [repriceValue, setRepriceValue] = useState('');
  const [repriceReason, setRepriceReason] = useState('');
  const [repricing, setRepricing] = useState(false);
  // Edición de la reserva (modelo/fechas/extras) — el lead 'quoted' se
  // convierte en reservación real ajustando aquí y confirmando.
  const [editTarget, setEditTarget] = useState<AdminBooking | null>(null);
  const [editForm, setEditForm] = useState({ modelSlug: '', start: '', end: '' });
  const [editExtras, setEditExtras] = useState<Record<number, number>>({});
  const [editNotes, setEditNotes] = useState('');
  const [editingSave, setEditingSave] = useState(false);

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

  // Deep-link ?code=<código> (globito de alerta): abre el diálogo de ESA
  // reserva al aterrizar. Espera a bookings + catálogo de extras; corre una
  // sola vez y limpia la URL.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code || bookings.length === 0 || extrasCatalog.length === 0) return;
    const target = bookings.find((b) => b.code === code);
    if (!target) return;
    openedRef.current = true;
    window.history.replaceState(null, '', '/admin/reservaciones');
    openEdit(target);
  }, [bookings, extrasCatalog]);

  // Catálogo de extras (precios BASE del catálogo; el precio final por
  // reserva es editable y queda registrado en pricing).
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/admin/extras');
      if (res.status === 401) return;
      const data = (await res.json()) as { extras: ExtraCatalogItem[] };
      setExtrasCatalog((data.extras ?? []).filter((e) => e.active));
    })().catch(() => undefined);
  }, []);

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
    const data = (await res.json().catch(() => ({}))) as { error?: string; from?: string; to?: string; hint?: string };
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    toast.error(
      data.error === 'invalid_transition'
        ? `Transición inválida: ${data.from} → ${data.to}`
        : data.error === 'unavailable'
          ? 'La unidad sigue ocupada en esas fechas: edítalas antes de confirmar'
          : 'No se pudo actualizar',
    );
  }

  async function submitReprice(e: React.FormEvent) {
    e.preventDefault();
    if (!priceTarget) return;
    const hasRate = repriceRate.trim() !== '';
    const hasDiscount = repriceKind !== 'none' && repriceValue.trim() !== '';
    if ((hasRate || hasDiscount) && repriceReason.trim().length < 3) {
      toast.error('El ajuste requiere motivo');
      return;
    }
    setRepricing(true);
    try {
      const res = await fetch(`/api/admin/bookings/${priceTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reprice: {
            ...(hasRate ? { dailyRateCents: Math.round(Number(repriceRate) * 100) } : {}),
            ...(hasDiscount
              ? {
                  discount: {
                    kind: repriceKind,
                    value:
                      repriceKind === 'pct' ? Number(repriceValue) : Math.round(Number(repriceValue) * 100),
                  },
                }
              : {}),
            ...(hasRate || hasDiscount ? { reason: repriceReason } : {}),
          },
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        const data = (await res.json()) as { booking: { total_cents: number; code: string } };
        toast.success(`${data.booking.code} → nuevo total ${moneyFmt.format(data.booking.total_cents / 100)}`);
        setPriceTarget(null);
        await loadBookings();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error === 'validation' ? 'Revisa los campos del ajuste' : 'No se pudo ajustar');
    } finally {
      setRepricing(false);
    }
  }

  function openEdit(b: AdminBooking) {
    setEditTarget(b);
    setEditForm({
      modelSlug: b.model_slug,
      start: new Date(b.period_start).toISOString().slice(0, 16),
      end: new Date(b.period_end).toISOString().slice(0, 16),
    });
    // Extras ACTUALES de la reserva (snapshot por nombre → ids del catálogo)
    const sel: Record<number, number> = {};
    for (const snap of b.extras ?? []) {
      const cat = extrasCatalog.find((c) => c.name === snap.name);
      if (cat) sel[cat.id] = snap.qty;
    }
    setEditExtras(sel);
    setEditNotes(b.notes ?? '');
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditingSave(true);
    try {
      const extras = Object.entries(editExtras).map(([id, qty]) => ({ id: Number(id), qty }));
      const res = await fetch(`/api/admin/bookings/${editTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          edit: {
            modelSlug: editForm.modelSlug,
            start: new Date(editForm.start).toISOString(),
            end: new Date(editForm.end).toISOString(),
            ...(extras.length > 0 ? { extras } : {}),
          },
          // Notas del staff: acuerdos, horas, condiciones (vacío = limpiar).
          notes: editNotes,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        toast.success('Reserva actualizada');
        setEditTarget(null);
        await loadBookings();
        return;
      }
      toast.error(res.status === 409 ? 'Sin disponibilidad para esa combinación' : 'No se pudo actualizar');
    } finally {
      setEditingSave(false);
    }
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
      // Ajustes de precio: extras con precio editado, tarifa fija o
      // descuento explícito viajan en `pricing` con MOTIVO (obligatorio).
      // Extras a precio de catálogo van por el camino simple (extras[]).
      const sel = Object.entries(extrasSel).map(([id, v]) => ({
        id: Number(id),
        qty: v.qty,
        priceCents: Math.round(v.price * 100),
      }));
      const catalogPrice = (id: number) => extrasCatalog.find((e) => e.id === id)?.priceCents ?? 0;
      const hasCustomPrice = sel.some((x) => x.priceCents !== catalogPrice(x.id));
      const hasRate = rateOverride.trim() !== '';
      const hasDiscount = discountKind !== 'none' && discountValue.trim() !== '';
      const needsPricing = hasRate || hasDiscount || hasCustomPrice;

      const body: Record<string, unknown> = {
        ...parsed.data,
        start: new Date(form.start).toISOString(),
        end: new Date(form.end).toISOString(),
      };
      if (form.kind === 'rental') {
        if (needsPricing) {
          body.pricing = {
            ...(hasRate ? { dailyRateCents: Math.round(Number(rateOverride) * 100) } : {}),
            ...(sel.length > 0 ? { extras: sel } : {}),
            ...(hasDiscount
              ? {
                  discount: {
                    kind: discountKind,
                    value:
                      discountKind === 'pct'
                        ? Number(discountValue)
                        : Math.round(Number(discountValue) * 100),
                  },
                }
              : {}),
            reason: priceReason,
          };
        } else if (sel.length > 0) {
          body.extras = sel.map((x) => ({ id: x.id, qty: x.qty }));
        }
      }
      const res = await fetch('/api/admin/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 201) {
        toast.success('Guardada');
        setCaptureOpen(false);
        setForm(emptyForm);
        setExtrasSel({});
        setRateOverride('');
        setDiscountKind('none');
        setDiscountValue('');
        setPriceReason('');
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
                        {b.requested?.channel === 'web' && b.status === 'quoted' && (
                          <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                            LEAD WEB
                          </span>
                        )}{''}
                      <>
                        <span className="font-medium">{b.customer_name}</span>
                        <span className="block text-xs text-muted-foreground">{b.customer_phone}</span>
                        {b.notes && (
                          <span className="block max-w-[16rem] truncate text-xs text-muted-foreground" title={b.notes}>
                            📝 {b.notes}
                          </span>
                        )}
                      </>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{b.plate}</span>
                    <span className="block text-xs text-muted-foreground">{b.model_name}</span>
                    {(b.segments?.filter((s) => s.status !== 'cancelled').length ?? 0) > 1 && (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {b.segments!
                          .filter((s) => s.status !== 'cancelled')
                          .map((s) => (
                            <span
                              key={s.id}
                              className="rounded bg-muted px-1.5 py-0.5 text-[10px]"
                              title={`${fmtShort(s.period_start)} → ${fmtShort(s.period_end)}${s.plate ? ` · ${s.plate}` : ''}`}
                            >
                              {s.idx}. {s.model_name}
                            </span>
                          ))}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {dtFmt.format(new Date(b.period_start))}
                    <br />
                    {dtFmt.format(new Date(b.period_end))}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.kind === 'block' ? (
                      '—'
                    ) : (
                      <>
                        {moneyFmt.format(b.total_cents / 100)}
                        {b.pricing?.discount && b.pricing.discount.kind !== 'none' && b.pricing.discount.kind !== 'auto' && (
                          <span
                            className="block text-xs text-emerald-700"
                            title={b.pricing.reason ?? b.pricing.discount.reason}
                          >
                            {b.pricing.discount.kind === 'pct'
                              ? `−${b.pricing.discount.value}%`
                              : `−${moneyFmt.format((b.pricing.discount.cents ?? 0) / 100)}`}
                            {b.pricing.reason ? ` · ${b.pricing.reason}` : ''}
                          </span>
                        )}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[b.status] ?? 'secondary'}>
                      {STATUS_LABEL[b.status] ?? b.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {b.kind === 'rental' && (b.status === 'quoted' || b.status === 'confirmed') && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(b)}>
                          Editar
                        </Button>
                      )}
                      {b.kind === 'rental' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setPriceTarget(b);
                            setRepriceRate(
                              b.pricing && 'dailyRateCents' in (b.pricing as object)
                                ? String((b.pricing as { dailyRateCents: number }).dailyRateCents / 100)
                                : '',
                            );
                            setRepriceKind('none');
                            setRepriceValue('');
                            setRepriceReason('');
                          }}
                        >
                          Precio
                        </Button>
                      )}
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

      {/* Edición de la reserva (modelo/fechas/extras) — núcleo del follow-up
          del lead: el staff ajusta lo que el cliente pidió y confirma. El
          pedido original queda congelado en `requested`. */}
      <Dialog
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEditTarget(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar reserva — {editTarget?.code}</DialogTitle>
            <DialogDescription>
              Cambia fechas, modelo o extras; la unidad se re-asigna y el precio se recalcula.
            </DialogDescription>
          </DialogHeader>

          {editTarget?.requested?.model && (
            <div className="rounded-xl border-2 border-brand/30 bg-brand-soft/40 p-4">
              <p className="text-sm font-bold text-brand-dark">Reservación original</p>
              <ul className="mt-2 space-y-1.5 text-sm">
                <li>
                  <span className="text-muted-foreground">Fechas:</span>{' '}
                  {fmtShort(editTarget.requested.start ?? '')}{' '}
                  {datesChanged(editTarget) && (
                    <>
                      <span className="mx-1 text-brand">→</span> {fmtShort(editTarget.period_start)}
                    </>
                  )}
                  {' a '}
                  {fmtShort(editTarget.requested.end ?? '')}
                  {datesChanged(editTarget) && (
                    <>
                      <span className="mx-1 text-brand">→</span> {fmtShort(editTarget.period_end)}
                    </>
                  )}
                </li>
                <li>
                  <span className="text-muted-foreground">Modelo:</span> {editTarget.requested.model.name}
                  {editTarget.requested.model.slug !== editTarget.model_slug && (
                    <>
                      <span className="mx-1 text-brand">→</span> {editTarget.model_name}
                    </>
                  )}
                </li>
                {unionExtras(editTarget).map((name) => (
                  <li key={name}>
                    <span className="text-muted-foreground">{name}:</span>{' '}
                    {editTarget.requested?.extras?.some((e) => e.name === name) ? '✅' : '❌'}
                    <span className="mx-1 text-brand">→</span>
                    {editTarget.extras?.some((e) => e.name === name) ? '✅' : '❌'}
                  </li>
                ))}
                {editTarget.requested.channel === 'web' && editTarget.requested.reason === 'sin_disponibilidad' && (
                  <li className="text-xs text-amber-700">
                    Lead capturado al fallar la disponibilidad en la web.
                  </li>
                )}
              </ul>
            </div>
          )}

          <form onSubmit={submitEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ed-model">Modelo</Label>
              <Select value={editForm.modelSlug} onValueChange={(v) => setEditForm({ ...editForm, modelSlug: v })}>
                <SelectTrigger id="ed-model">
                  <SelectValue placeholder="Elige el modelo" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.slug} value={m.slug}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ed-start">Inicio</Label>
                <Input
                  id="ed-start"
                  type="datetime-local"
                  value={editForm.start}
                  onChange={(e) => setEditForm({ ...editForm, start: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ed-end">Fin</Label>
                <Input
                  id="ed-end"
                  type="datetime-local"
                  value={editForm.end}
                  onChange={(e) => setEditForm({ ...editForm, end: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Extras</p>
              {extrasCatalog.map((extra) => (
                <div key={extra.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#0e7490]"
                    checked={editExtras[extra.id] !== undefined}
                    onChange={(e) =>
                      setEditExtras((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[extra.id] = 1;
                        else delete next[extra.id];
                        return next;
                      })
                    }
                    aria-label={extra.name}
                  />
                  <span className="flex-1 text-sm">{extra.name}</span>
                  {editExtras[extra.id] !== undefined && (
                    <input
                      type="number"
                      min={1}
                      className="h-8 w-16 rounded-md border px-2 text-sm"
                      value={editExtras[extra.id]}
                      aria-label={`Cantidad ${extra.name}`}
                      onChange={(e) =>
                        setEditExtras((prev) => ({ ...prev, [extra.id]: Math.max(1, Number(e.target.value) || 1) }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ed-notes">Notas del staff</Label>
              <Textarea
                id="ed-notes"
                rows={2}
                placeholder="ej. entrega acordada 7:00 am en llegadas, cliente prefiere mensajes…"
                value={editNotes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditNotes(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={editingSave}>
                {editingSave ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ajuste de precio de una reserva EXISTENTE: recalcula desde el motor
          con los overrides; el motivo y el autor quedan en pricing. */}
      <Dialog
        open={priceTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPriceTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar precio — {priceTarget?.code}</DialogTitle>
            <DialogDescription>
              Total actual {priceTarget ? moneyFmt.format(priceTarget.total_cents / 100) : ''}. El
              desglose se recalcula desde el motor y el motivo queda registrado.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitReprice} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rp-rate">Tarifa diaria fija (MXN)</Label>
              <Input
                id="rp-rate"
                type="number"
                min={0}
                placeholder="Tarifa del catálogo"
                value={repriceRate}
                onChange={(e) => setRepriceRate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Descuento explícito</Label>
              <div className="flex gap-1">
                <Select value={repriceKind} onValueChange={(v) => setRepriceKind(v as 'none' | 'pct' | 'amount')}>
                  <SelectTrigger className="h-9 w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ninguno</SelectItem>
                    <SelectItem value="pct">%</SelectItem>
                    <SelectItem value="amount">$</SelectItem>
                  </SelectContent>
                </Select>
                {repriceKind !== 'none' && (
                  <Input
                    type="number"
                    min={0}
                    placeholder={repriceKind === 'pct' ? '10' : '150'}
                    value={repriceValue}
                    onChange={(e) => setRepriceValue(e.target.value)}
                    aria-label="Valor del descuento"
                  />
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rp-reason">Motivo (obligatorio al ajustar)</Label>
              <Input
                id="rp-reason"
                placeholder="ej. se quejó del aire acondicionado…"
                value={repriceReason}
                onChange={(e) => setRepriceReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPriceTarget(null)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={repricing}>
                {repricing ? 'Ajustando…' : 'Aplicar ajuste'}
              </Button>
            </DialogFooter>
          </form>
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

            {form.kind === 'rental' && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Extras (precio editable)</p>
                {extrasCatalog.length === 0 && (
                  <p className="text-xs text-muted-foreground">Sin extras en el catálogo.</p>
                )}
                {extrasCatalog.map((extra) => {
                  const sel = extrasSel[extra.id];
                  return (
                    <div key={extra.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#0e7490]"
                        checked={!!sel}
                        onChange={(e) =>
                          setExtrasSel((prev) => {
                            const next = { ...prev };
                            if (e.target.checked) next[extra.id] = { qty: 1, price: extra.priceCents / 100 };
                            else delete next[extra.id];
                            return next;
                          })
                        }
                        aria-label={extra.name}
                      />
                      <span className="flex-1 text-sm">{extra.name}</span>
                      {sel && (
                        <>
                          <input
                            type="number"
                            min={1}
                            className="h-8 w-16 rounded-md border px-2 text-sm"
                            value={sel.qty}
                            aria-label={`Cantidad ${extra.name}`}
                            onChange={(e) =>
                              setExtrasSel((prev) => ({
                                ...prev,
                                [extra.id]: { ...sel, qty: Math.max(1, Number(e.target.value) || 1) },
                              }))
                            }
                          />
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">$</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              className="h-8 w-20 rounded-md border px-2 text-sm"
                              value={sel.price}
                              aria-label={`Precio ${extra.name}`}
                              onChange={(e) =>
                                setExtrasSel((prev) => ({
                                  ...prev,
                                  [extra.id]: { ...sel, price: Number(e.target.value) || 0 },
                                }))
                              }
                            />
                            <span className="text-xs text-muted-foreground">/ {extra.per === 'day' ? 'día' : 'renta'}</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {form.kind === 'rental' && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <p className="text-sm font-medium">Ajustes de precio (opcional)</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="cap-rate">Tarifa diaria fija (MXN)</Label>
                    <Input
                      id="cap-rate"
                      type="number"
                      min={0}
                      placeholder="Catálogo"
                      value={rateOverride}
                      onChange={(e) => setRateOverride(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Descuento</Label>
                    <div className="flex gap-1">
                      <Select value={discountKind} onValueChange={(v) => setDiscountKind(v as 'none' | 'pct' | 'amount')}>
                        <SelectTrigger className="h-9 w-24">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Ninguno</SelectItem>
                          <SelectItem value="pct">%</SelectItem>
                          <SelectItem value="amount">$</SelectItem>
                        </SelectContent>
                      </Select>
                      {discountKind !== 'none' && (
                        <Input
                          type="number"
                          min={0}
                          placeholder={discountKind === 'pct' ? '10' : '150'}
                          value={discountValue}
                          onChange={(e) => setDiscountValue(e.target.value)}
                          aria-label="Valor del descuento"
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cap-reason">Motivo del ajuste</Label>
                  <Input
                    id="cap-reason"
                    placeholder="ej. cliente frecuente, tarifa telefónica acordada…"
                    value={priceReason}
                    onChange={(e) => setPriceReason(e.target.value)}
                  />
                  {(rateOverride || discountKind !== 'none') && priceReason.trim().length < 3 && (
                    <p className="text-xs text-destructive">Obligatorio al ajustar tarifa o descuento.</p>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="cap-notes">Notas {form.kind === 'block' ? '(motivo del bloqueo)' : '(opcionales)'}</Label>
              <Textarea
                id="cap-notes"
                rows={2}
                placeholder="ej. entrega acordada 7:00 am en llegadas, cliente prefiere WhatsApp…"
                value={form.notes}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, notes: e.target.value })}
              />
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
// ~300 kB y cobra uso comercial; aquí basta lectura visual. Desde la
// migración 006 las barras son por TRAMO: una renta multi-vehículo pinta un
// tramo por unidad.
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

  // Clampa a los bordes del mes visible: un tramo que empieza el mes
  // anterior NO puede producir anchos negativos.
  function bar(startIso: string, endIso: string): { leftPct: number; widthPct: number } | null {
    const s = new Date(startIso);
    const e = new Date(endIso);
    if (s >= monthEnd || e <= monthStart) return null;
    const cs = Math.max(s.getTime(), monthStart.getTime());
    const ce = Math.min(e.getTime(), monthEnd.getTime());
    return {
      leftPct: ((cs - monthStart.getTime()) / monthMs) * 100,
      widthPct: (Math.max(ce - cs, 86_400_000 * 0.25) / monthMs) * 100,
    };
  }

  // Colores por estado del TRAMO (reserved = la renta confirmada).
  const barColor: Record<string, string> = {
    reserved: 'bg-sky-200 text-sky-900',
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
              {bookings.flatMap((b) =>
                (b.segments ?? [])
                  .filter((s) => s.plate === unit.plate)
                  .map((s) => {
                    const dims = bar(s.period_start, s.period_end);
                    if (!dims) return null;
                    return (
                      <div
                        key={s.id}
                        className={`absolute top-0.5 h-6 truncate rounded px-1 text-[10px] leading-6 ${
                          b.kind === 'block'
                            ? 'bg-[repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0_4px,#cbd5e1_4px,#cbd5e1_8px)] text-gray-700'
                            : barColor[s.status] ?? 'bg-gray-200'
                        }`}
                        style={{ left: `${dims.leftPct}%`, width: `${dims.widthPct}%` }}
                        title={`${b.code}${(b.segments?.length ?? 0) > 1 ? ` · tramo ${s.idx}` : ''} · ${b.customer_name ?? 'BLOQUEO'} · ${s.status}`}
                      >
                        {b.kind === 'block' ? '🔧 ' : ''}
                        {(b.segments?.length ?? 0) > 1 ? `${s.idx}·` : ''}
                        {b.code}
                      </div>
                    );
                  }),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

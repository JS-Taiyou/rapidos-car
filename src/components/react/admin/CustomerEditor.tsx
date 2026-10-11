// CustomerEditor — expediente del cliente (montado en /admin/clientes/[id]):
// datos editables (nombre, CURP, contacto, notas, no-show), historial de
// contacto retirado (jsonb, solo lectura) y las reservas vinculadas con link
// directo a su diálogo en Reservaciones. Solo español.
import { useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Textarea } from '../../ui/textarea';
import { Toaster, toast } from '../../ui/sonner';

export interface EditableCustomer {
  id: number;
  curp: string;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
  noShow: boolean;
  contactHistory: Array<{ kind: string; value: string; retiredAt: string }>;
  rentals: number;
}

interface BookingRow {
  id: number;
  code: string;
  status: string;
  kind: 'rental' | 'block';
  total_cents: number;
  period_start: string;
  period_end: string;
  model_name: string;
  plate: string;
}

const STATUS_LABEL: Record<string, string> = {
  quoted: 'Cotizada',
  confirmed: 'Confirmada',
  active: 'Activa',
  completed: 'Completada',
  cancelled: 'Cancelada',
};

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const dateFmt = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'America/Merida' });

export default function CustomerEditor({ customer }: { customer: EditableCustomer }) {
  const [form, setForm] = useState({
    fullName: customer.fullName,
    curp: customer.curp,
    email: customer.email,
    phone: customer.phone,
    notes: customer.notes,
    noShow: customer.noShow,
  });
  const [saving, setSaving] = useState(false);
  const [bookings, setBookings] = useState<BookingRow[]>([]);

  async function loadBookings() {
    const res = await fetch(`/api/admin/customers/${customer.id}`);
    if (res.ok) {
      const data = (await res.json()) as { bookings: BookingRow[] };
      setBookings(data.bookings ?? []);
    }
  }
  // carga inicial (una sola vez por expediente)
  if (!loadedOnce.has(customer.id)) {
    loadedOnce.add(customer.id);
    void loadBookings();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: form.fullName,
          ...(form.curp.trim() ? { curp: form.curp.trim().toUpperCase() } : { curp: null }),
          ...(form.email.trim() ? { email: form.email.trim() } : { email: null }),
          ...(form.phone.trim() ? { phone: form.phone.trim() } : { phone: null }),
          notes: form.notes.trim() || null,
          noShow: form.noShow,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json()) as {
        error?: string;
        issues?: Array<{ message: string }>;
        customer?: { id: number };
        mergedInto?: { id: number; fullName: string };
      };
      if (res.ok && data.customer) {
        if (data.mergedInto) {
          toast.success(`Unificado con el expediente de ${data.mergedInto.fullName} (el CURP ya existía)`);
          // El expediente fuente dejó de existir: al sobreviviente.
          window.location.href = `/admin/clientes/${data.mergedInto.id}`;
          return;
        }
        toast.success('Expediente guardado');
        await loadBookings();
        return;
      }
      if (data.error === 'validation') {
        toast.error(data.issues?.[0]?.message ?? 'Revisa los campos');
        return;
      }
      toast.error('No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Toaster />
      <div className="grid gap-8 lg:grid-cols-2">
        <form onSubmit={save} className="space-y-4 rounded-xl border bg-background p-5">
          <fieldset className="space-y-4">
            <legend className="px-1 text-sm font-semibold">Expediente</legend>
            <div className="space-y-1.5">
              <Label htmlFor="cu-name">Nombre completo</Label>
              <Input id="cu-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-curp">CURP (de la identificación oficial)</Label>
              <Input
                id="cu-curp"
                placeholder="XEXX010101HNEXXXA4"
                className="font-mono uppercase"
                value={form.curp}
                onChange={(e) => setForm({ ...form, curp: e.target.value.toUpperCase() })}
              />
              <p className="text-xs text-muted-foreground">
                Si el CURP ya existía en otro expediente, se unifican (gana el registro antiguo).
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cu-email">Email</Label>
                <Input id="cu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cu-phone">Teléfono</Label>
                <Input id="cu-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cu-notes">Notas del expediente</Label>
              <Textarea id="cu-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-red-600"
                checked={form.noShow}
                onChange={(e) => setForm({ ...form, noShow: e.target.checked })}
              />
              Marcar como <strong>no-show</strong>
            </label>
            <div>
              <Button type="submit" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar expediente'}
              </Button>
            </div>
          </fieldset>
        </form>

        <div className="space-y-6">
          <section className="rounded-xl border bg-background">
            <h2 className="border-b px-5 py-3 font-semibold">Contacto retirado</h2>
            {customer.contactHistory.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">
                Sin datos anteriores — el contacto vigente está en el expediente.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {customer.contactHistory.map((h) => (
                  <li className="flex items-center justify-between px-5 py-2.5">
                    <span className="font-mono text-xs">{h.value}</span>
                    <span className="text-xs text-muted-foreground">
                      {h.kind === 'email' ? 'email' : 'teléfono'} · retirado {dateFmt.format(new Date(h.retiredAt))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border bg-background">
            <h2 className="border-b px-5 py-3 font-semibold">Reservas ({bookings.length})</h2>
            {bookings.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-muted-foreground">Sin reservas vinculadas.</p>
            ) : (
              <ul className="divide-y text-sm">
                {bookings.map((b) => (
                  <li>
                    <a
                      href={`/admin/reservaciones?code=${encodeURIComponent(b.code)}`}
                      className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-accent/50"
                    >
                      <span>
                        <span className="font-mono text-xs">{b.code}</span>
                        <span className="block text-xs text-muted-foreground">
                          {b.model_name} · {dateFmt.format(new Date(b.period_start))} → {dateFmt.format(new Date(b.period_end))}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {b.status === 'quoted' && <Badge variant="warning">lead</Badge>}
                        <Badge variant={b.status === 'cancelled' ? 'destructive' : b.status === 'completed' ? 'secondary' : 'default'}>
                          {STATUS_LABEL[b.status] ?? b.status}
                        </Badge>
                        <span className="tabular-nums">{moneyFmt.format(b.total_cents / 100)}</span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

// Carga única por expediente (módulo, sin refetch loops).
const loadedOnce = new Set<number>();

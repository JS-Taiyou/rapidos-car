// RatesEditor — tarifas del motor (ROADMAP Fase 6): pestañas Temporadas y
// Extras. Las temporadas se ven de año completo en una franja SVG (bloques
// coloreados sobre los 12 meses) y se editan en tabla; la prioridad desempata
// solapes (mayor gana — la regla vive en el motor). Los extras se editan
// inline (precio en PESOS, la API habla centavos). Solo español.
import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { Toaster, toast } from '../../ui/sonner';
import MoneyInput from '../../ui/money-input';

interface SeasonRow {
  id: number;
  name: string;
  from_date: string;
  to_date: string;
  multiplier: number;
  priority: number;
}

interface ExtraRow {
  id: number;
  name: string;
  priceCents: number;
  per: 'day' | 'rental';
  active: boolean;
}

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const SEASON_COLORS = ['#0e7490', '#d97706', '#e11d48', '#0284c7', '#059669', '#7c3aed'];

function dayOfYear(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return (d.getTime() - start) / 86_400_000;
}

export default function RatesEditor() {
  const [tab, setTab] = useState<'seasons' | 'extras'>('seasons');
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [extras, setExtras] = useState<ExtraRow[]>([]);
  const [newSeason, setNewSeason] = useState({ name: '', from: '', to: '', multiplier: '1.2', priority: '0' });
  const [newExtra, setNewExtra] = useState({ name: '', price: '', per: 'rental' as 'day' | 'rental' });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const [sRes, eRes] = await Promise.all([fetch('/api/admin/seasons'), fetch('/api/admin/extras')]);
    if (sRes.status === 401 || eRes.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const sData = (await sRes.json()) as { seasons: SeasonRow[] };
    const eData = (await eRes.json()) as { extras: ExtraRow[] };
    setSeasons((sData.seasons ?? []).map((s) => ({ ...s, multiplier: Number(s.multiplier) })));
    setExtras(eData.extras ?? []);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  // ---- Temporadas ----------------------------------------------------------
  async function saveSeason(s: SeasonRow) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/seasons/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: s.name,
          from: s.from_date,
          to: s.to_date,
          multiplier: s.multiplier,
          priority: s.priority,
        }),
      });
      if (res.ok) {
        toast.success(`Temporada "${s.name}" guardada`);
        await load();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { issues?: Array<{ message: string }> };
      toast.error(data.issues?.[0]?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function deleteSeason(s: SeasonRow) {
    if (!confirm(`¿Eliminar la temporada "${s.name}"?`)) return;
    const res = await fetch(`/api/admin/seasons/${s.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Temporada eliminada');
      await load();
    }
  }

  async function createSeason(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newSeason.name,
          from: newSeason.from,
          to: newSeason.to,
          multiplier: Number(newSeason.multiplier),
          priority: Number(newSeason.priority),
        }),
      });
      if (res.status === 201) {
        setNewSeason({ name: '', from: '', to: '', multiplier: '1.2', priority: '0' });
        toast.success('Temporada creada');
        await load();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { issues?: Array<{ message: string }> };
      toast.error(data.issues?.[0]?.message ?? 'No se pudo crear');
    } finally {
      setSaving(false);
    }
  }

  // ---- Extras --------------------------------------------------------------
  async function saveExtra(x: ExtraRow) {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/extras?id=${x.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: x.name,
          priceCents: x.priceCents,
          per: x.per,
          active: x.active,
        }),
      });
      if (res.ok) {
        toast.success(`Extra "${x.name}" guardado`);
        await load();
        return;
      }
      toast.error('No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function deleteExtra(x: ExtraRow) {
    if (!confirm(`¿Eliminar el extra "${x.name}"? (las reservas existentes conservan su snapshot)`)) return;
    const res = await fetch(`/api/admin/extras?id=${x.id}`, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Extra eliminado');
      await load();
    }
  }

  async function createExtra(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/extras', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newExtra.name,
          priceCents: Math.round(Number(newExtra.price) * 100),
          per: newExtra.per,
          active: true,
        }),
      });
      if (res.status === 201) {
        setNewExtra({ name: '', price: '', per: 'rental' });
        toast.success('Extra creado');
        await load();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error === 'duplicate_name' ? 'Ya existe un extra con ese nombre' : 'No se pudo crear');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Toaster />

      <div className="flex gap-1" data-tour="tarifas-tabs">
        <Button variant={tab === 'seasons' ? 'default' : 'outline'} size="sm" onClick={() => setTab('seasons')}>
          Temporadas
        </Button>
        <Button variant={tab === 'extras' ? 'default' : 'outline'} size="sm" onClick={() => setTab('extras')}>
          Extras
        </Button>
      </div>

      {tab === 'seasons' ? (
        <>
          {/* Franja anual: el año de un vistazo. Cada temporada una franja
              delgada; los solapes se VEN. */}
          <div className="rounded-xl border bg-background p-4" data-tour="tarifas-franja">
            <p className="mb-2 text-sm font-semibold">El año de un vistazo</p>
            <div className="overflow-x-auto">
              <svg viewBox="0 0 732 100" className="min-w-[560px]" role="img" aria-label="Calendario de temporadas">
                {MONTHS.map((m, i) => (
                  <g key={m}>
                    <rect x={i * 61} y={0} width={61} height={100} fill={i % 2 === 0 ? '#f8fafc' : '#f1f5f9'} />
                    <text x={i * 61 + 30.5} y={94} textAnchor="middle" fontSize="10" fill="#64748b">
                      {m}
                    </text>
                  </g>
                ))}
                {seasons.map((s, i) => {
                  const color = SEASON_COLORS[i % SEASON_COLORS.length];
                  const x = (dayOfYear(s.from_date) / 365) * 732;
                  const w = Math.max(((dayOfYear(s.to_date) - dayOfYear(s.from_date)) / 365) * 732, 6);
                  const y = 12 + i * 18;
                  return (
                    <g key={s.id}>
                      <rect x={x} y={y} width={Math.min(w, 732 - x)} height={13} rx={3} fill={color} opacity={0.85} />
                      <text x={Math.min(x + 4, 600)} y={y + 10} fontSize="9" fill="#fff" fontWeight="600">
                        {s.name.length > 18 ? `${s.name.slice(0, 17)}…` : s.name}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Cuando dos temporadas se solapan, gana la de <strong>mayor prioridad</strong>.
            </p>
          </div>

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Desde</TableHead>
                  <TableHead>Hasta</TableHead>
                  <TableHead>Multiplicador</TableHead>
                  <TableHead>Prioridad</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {seasons.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                      Sin temporadas: todos los días se cotizan a tarifa de catálogo.
                    </TableCell>
                  </TableRow>
                )}
                {seasons.map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Input
                        value={s.name}
                        aria-label={`Nombre de temporada ${i + 1}`}
                        onChange={(e) => setSeasons((prev) => prev.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={s.from_date?.slice(0, 10) ?? ''}
                        aria-label={`Inicio de temporada ${i + 1}`}
                        onChange={(e) => setSeasons((prev) => prev.map((x) => (x.id === s.id ? { ...x, from_date: e.target.value } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="date"
                        value={s.to_date?.slice(0, 10) ?? ''}
                        aria-label={`Fin de temporada ${i + 1}`}
                        onChange={(e) => setSeasons((prev) => prev.map((x) => (x.id === s.id ? { ...x, to_date: e.target.value } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0.5}
                        max={3}
                        step={0.05}
                        className="w-20"
                        value={s.multiplier}
                        aria-label={`Multiplicador de temporada ${i + 1}`}
                        onChange={(e) => setSeasons((prev) => prev.map((x) => (x.id === s.id ? { ...x, multiplier: Number(e.target.value) } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        max={99}
                        className="w-16"
                        value={s.priority}
                        aria-label={`Prioridad de temporada ${i + 1}`}
                        onChange={(e) => setSeasons((prev) => prev.map((x) => (x.id === s.id ? { ...x, priority: Number(e.target.value) } : x)))}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={saving} onClick={() => saveSeason(s)}>
                          ✓
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteSeason(s)} aria-label={`Eliminar ${s.name}`}>
                          ✕
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <form onSubmit={createSeason} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-4">
            <div className="space-y-1">
              <Label htmlFor="ns-name">Nueva temporada</Label>
              <Input id="ns-name" placeholder="ej. Puente diciembre" className="w-44" required
                value={newSeason.name} onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-from">Desde</Label>
              <Input id="ns-from" type="date" required value={newSeason.from}
                onChange={(e) => setNewSeason({ ...newSeason, from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-to">Hasta</Label>
              <Input id="ns-to" type="date" required value={newSeason.to}
                onChange={(e) => setNewSeason({ ...newSeason, to: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-mult">× Tarifa</Label>
              <Input id="ns-mult" type="number" min={0.5} max={3} step={0.05} className="w-20" required
                value={newSeason.multiplier} onChange={(e) => setNewSeason({ ...newSeason, multiplier: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ns-prio">Prioridad</Label>
              <Input id="ns-prio" type="number" min={0} max={99} className="w-20"
                value={newSeason.priority} onChange={(e) => setNewSeason({ ...newSeason, priority: e.target.value })} />
            </div>
            <Button type="submit" disabled={saving}>
              + Crear
            </Button>
          </form>
        </>
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Precio (MXN)</TableHead>
                  <TableHead>Cobro</TableHead>
                  <TableHead>Activo</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {extras.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      Sin extras en el catálogo.
                    </TableCell>
                  </TableRow>
                )}
                {extras.map((x) => (
                  <TableRow key={x.id} className={x.active ? '' : 'opacity-60'}>
                    <TableCell>
                      <Input
                        value={x.name}
                        aria-label={`Nombre de extra ${x.id}`}
                        onChange={(e) => setExtras((prev) => prev.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))}
                      />
                    </TableCell>
                    <TableCell>
                      <MoneyInput
                        min={0}
                        step="0.01"
                        className="w-24"
                        value={x.priceCents / 100}
                        aria-label={`Precio de ${x.name}`}
                        onChange={(e) =>
                          setExtras((prev) => prev.map((y) => (y.id === x.id ? { ...y, priceCents: Math.round(Number(e.target.value) * 100) } : y)))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={x.per}
                        onValueChange={(v) => setExtras((prev) => prev.map((y) => (y.id === x.id ? { ...y, per: v as 'day' | 'rental' } : y)))}
                      >
                        <SelectTrigger className="w-28" aria-label={`Cobro de ${x.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="rental">por renta</SelectItem>
                          <SelectItem value="day">por día</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-[#0e7490]"
                        checked={x.active}
                        aria-label={`${x.name} activo`}
                        onChange={(e) => setExtras((prev) => prev.map((y) => (y.id === x.id ? { ...y, active: e.target.checked } : y)))}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" disabled={saving} onClick={() => saveExtra(x)}>
                          ✓
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteExtra(x)} aria-label={`Eliminar ${x.name}`}>
                          ✕
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <form onSubmit={createExtra} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-4">
            <div className="space-y-1">
              <Label htmlFor="nx-name">Nuevo extra</Label>
              <Input id="nx-name" placeholder="ej. Silla de bebé" className="w-44" required
                value={newExtra.name} onChange={(e) => setNewExtra({ ...newExtra, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nx-price">Precio (MXN)</Label>
              <MoneyInput id="nx-price" min={0} step="0.01" className="w-24" required
                value={newExtra.price} onChange={(e) => setNewExtra({ ...newExtra, price: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Cobro</Label>
              <Select value={newExtra.per} onValueChange={(v) => setNewExtra({ ...newExtra, per: v as 'day' | 'rental' })}>
                <SelectTrigger className="w-28" aria-label="Cobro del nuevo extra">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rental">por renta</SelectItem>
                  <SelectItem value="day">por día</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={saving}>
              + Crear
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Los precios de catálogo alimentan la cotización web; el precio final por reserva queda congelado en su
            snapshot al reservar. <Badge variant="secondary">ej. {moneyFmt.format(150)}</Badge>
          </p>
        </>
      )}
    </div>
  );
}

// FleetManager — CRUD del inventario en sus dos niveles (§3): MODELOS (lo
// que se cotiza) y UNIDADES (las placas físicas). DELETE siempre LÓGICO
// (active=false / status='retired'): bookings referencia vehicle_id y el
// historial no se rompe. Solo español.
import { useState, useEffect, useCallback, Fragment } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import { Textarea } from '../../ui/textarea';
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
import PhotoDropzone from './PhotoDropzone';
import { vehicleUpsertSchema } from '../../../lib/validation';

interface UnitRow {
  id: number;
  plate: string;
  status: 'active' | 'maintenance' | 'retired';
}

interface ModelRow {
  id: number;
  slug: string;
  name: string;
  category: string;
  transmission: 'automatic' | 'manual';
  seats: number;
  luggage: number;
  dailyRateCents: number;
  photos: string[];
  active: boolean;
  units: UnitRow[];
}

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

// slugify de 3 líneas: normalize + quitar diacríticos + regex. Sin dependencia.
function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const CATEGORIES = ['small', 'compact', 'medium', 'large', 'van', 'cargo'];
const emptyModel = {
  name: '',
  slug: '',
  category: 'compact',
  transmission: 'automatic' as 'automatic' | 'manual',
  seats: 5,
  luggage: 2,
  dailyRate: 500,
  photos: '',
  plates: '',
};

export default function FleetManager() {
  const [models, setModels] = useState<ModelRow[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyModel);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelRow | null>(null);
  const [retireUnits, setRetireUnits] = useState(true);
  const [newPlates, setNewPlates] = useState<Record<number, string>>({});
  // Fotos recién seleccionadas: preview con blob: URLs (locales al navegador,
  // desechables — NADA viaja aún). Al confirmar, los archivos originales se
  // suben y el servidor los procesa con sharp.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);

  function clearPending() {
    for (const url of pendingPreviews) URL.revokeObjectURL(url);
    setPendingFiles([]);
    setPendingPreviews([]);
  }

  function addFiles(list: File[]) {
    const accepted: File[] = [];
    const urls: string[] = [];
    for (const file of list) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) continue;
      accepted.push(file);
      urls.push(URL.createObjectURL(file));
    }
    setPendingFiles((prev) => [...prev, ...accepted].slice(0, 6));
    setPendingPreviews((prev) => [...prev, ...urls].slice(0, 6));
  }

  function removePending(index: number) {
    URL.revokeObjectURL(pendingPreviews[index]);
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    setPendingPreviews((prev) => prev.filter((_, i) => i !== index));
  }

  const loadFleet = useCallback(async () => {
    const res = await fetch('/api/admin/vehicles');
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const data = (await res.json()) as { models: ModelRow[] };
    setModels(data.models ?? []);
  }, []);

  useEffect(() => {
    loadFleet().catch(() => undefined);
  }, [loadFleet]);

  function openCreate() {
    setForm(emptyModel);
    setFormErrors({});
    clearPending();
    setDialogOpen(true);
  }

  // La edición de modelos es pantalla propia (/admin/flota/[id]) con
  // galería; desde aquí sólo se navega.

  async function submitModel(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormErrors({});
    try {
      const candidate = {
        slug: form.slug,
        name: form.name,
        category: form.category,
        transmission: form.transmission,
        seats: Number(form.seats),
        luggage: Number(form.luggage),
        // Convierte pesos → centavos ANTES de enviar (§2.13).
        dailyRateCents: Math.round(Number(form.dailyRate) * 100),
        photos: form.photos
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        units: form.plates.trim()
          ? form.plates
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean)
              .map((plate) => ({ plate }))
          : undefined,
      };
      const parsed = vehicleUpsertSchema.safeParse(candidate);
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          if (!errors[issue.path[0]]) errors[issue.path[0]] = issue.message;
        }
        setFormErrors(errors);
        return;
      }

      // Si hay archivos pendientes, AHORA sí viajan los originales: suben
      // por multipart, el servidor los optimiza (WebP) y devuelve las rutas.
      let uploadedPaths: string[] = [];
      if (pendingFiles.length > 0) {
        const fd = new FormData();
        for (const file of pendingFiles) fd.append('photos', file);
        const upload = await fetch('/api/admin/vehicles/photos', { method: 'POST', body: fd });
        if (upload.status === 401) {
          window.location.href = '/admin/login';
          return;
        }
        if (!upload.ok) {
          toast.error('No se pudieron subir las fotos');
          return;
        }
        uploadedPaths = ((await upload.json()) as { paths: string[] }).paths;
      }

      const res = await fetch('/api/admin/vehicles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parsed.data, photos: [...parsed.data.photos, ...uploadedPaths] }),
      });
      if (res.ok) {
        toast.success('Modelo creado');
        setDialogOpen(false);
        clearPending();
        await loadFleet();
        return;
      }
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; slug?: string; plate?: string };
      if (data.error === 'duplicate_slug') {
        setFormErrors({ slug: `El slug "${data.slug}" ya existe; cámbialo o edita ese modelo.` });
      } else if (data.error === 'duplicate_plate') {
        setFormErrors({ plates: `La placa "${data.plate}" ya existe.` });
      } else {
        toast.error('No se pudo guardar');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(model: ModelRow) {
    const res = await fetch(`/api/admin/vehicles/${model.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !model.active }),
    });
    if (res.ok) await loadFleet();
  }

  async function deleteModel() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/admin/vehicles/${deleteTarget.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retireUnits }),
    });
    if (res.ok) {
      toast.success('Modelo dado de baja (borrado lógico)');
      setDeleteTarget(null);
      await loadFleet();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string; bookings?: unknown[] };
    if (data.error === 'has_future_bookings') {
      toast.error(
        `Tiene ${data.bookings?.length ?? '?'} rentas futuras: reasígnalas o cancélalas primero.`,
      );
    } else {
      toast.error('No se pudo dar de baja');
    }
  }

  async function addUnit(modelId: number) {
    const plate = (newPlates[modelId] ?? '').trim();
    if (!plate) return;
    const res = await fetch(`/api/admin/vehicles/${modelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addUnits: [{ plate }] }),
    });
    if (res.ok) {
      setNewPlates({ ...newPlates, [modelId]: '' });
      await loadFleet();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { plate?: string };
    toast.error(data.plate ? `La placa ${data.plate} ya existe` : 'No se pudo agregar la unidad');
  }

  async function setUnitStatus(model: ModelRow, unit: UnitRow, status: UnitRow['status']) {
    const res = await fetch(`/api/admin/vehicles/${model.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setUnitStatus: { unitId: unit.id, status } }),
    });
    if (res.ok) await loadFleet();
  }

  function toggleExpanded(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <Toaster />
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Los modelos inactivos dejan de cotizarse; el historial siempre se conserva.
        </p>
        <Button onClick={openCreate}>+ Nuevo modelo</Button>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Modelo</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Tarifa/día</TableHead>
              <TableHead>Unidades</TableHead>
              <TableHead>Activo</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Sin modelos. Crea el primero con “+ Nuevo modelo”.
                </TableCell>
              </TableRow>
            )}
            {models.map((model) => (
              <Fragment key={model.id}>
                <TableRow>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => toggleExpanded(model.id)} aria-label="Unidades">
                      {expanded.has(model.id) ? '▾' : '▸'}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{model.name}</span>
                    <span className="block font-mono text-xs text-muted-foreground">/flota/{model.slug}</span>
                  </TableCell>
                  <TableCell className="capitalize">{model.category}</TableCell>
                  <TableCell>{moneyFmt.format(model.dailyRateCents / 100)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{model.units.length}</Badge>
                  </TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#0e7490]"
                      checked={model.active}
                      onChange={() => toggleActive(model)}
                      aria-label={`Activo ${model.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => (window.location.href = `/admin/flota/${model.id}`)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(model)}>
                        Eliminar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded.has(model.id) && (
                  <TableRow>
                    <TableCell colSpan={7} className="bg-muted/30">
                      <div className="space-y-2 pl-6">
                        {model.units.length === 0 && (
                          <p className="text-sm text-muted-foreground">Sin unidades registradas.</p>
                        )}
                        {model.units.map((unit) => (
                          <div key={unit.id} className="flex max-w-md items-center gap-2">
                            <span className="w-24 font-mono text-xs">{unit.plate}</span>
                            <Select
                              value={unit.status}
                              onValueChange={(v) => setUnitStatus(model, unit, v as UnitRow['status'])}
                            >
                              <SelectTrigger className="h-8 w-40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Activa</SelectItem>
                                <SelectItem value="maintenance">Taller</SelectItem>
                                <SelectItem value="retired">Retirada</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        ))}
                        <div className="flex max-w-md items-center gap-2 pt-1">
                          <Input
                            placeholder="Nueva placa (ej. YXB-1236)"
                            className="h-8"
                            value={newPlates[model.id] ?? ''}
                            onChange={(e) => setNewPlates({ ...newPlates, [model.id]: e.target.value })}
                          />
                          <Button size="sm" variant="outline" onClick={() => addUnit(model.id)}>
                            Agregar
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Alta de modelo (la edición es pantalla propia en /admin/flota/[id]) */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          // Al cerrar (X, overlay, submit) se liberan los blob: URLs.
          if (!open) clearPending();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo modelo</DialogTitle>
            <DialogDescription>
              La tarifa se captura en pesos; el sistema la guarda en centavos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitModel} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="fm-name">Nombre</Label>
                <Input
                  id="fm-name"
                  value={form.name}
                  onBlur={() => !form.slug && setForm({ ...form, slug: slugify(form.name) })}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                {formErrors.name && <p className="text-xs text-destructive">{formErrors.name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm-slug">Slug (URL)</Label>
                <Input id="fm-slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
                {formErrors.slug && <p className="text-xs text-destructive">{formErrors.slug}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm-category">Categoría</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger id="fm-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {{ small: 'Chico', compact: 'Compacto', medium: 'Mediano', large: 'Grande', van: 'Van', cargo: 'Carga' }[c] ?? c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formErrors.category && <p className="text-xs text-destructive">{formErrors.category}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm-transmission">Transmisión</Label>
                <Select
                  value={form.transmission}
                  onValueChange={(v) => setForm({ ...form, transmission: v as 'automatic' | 'manual' })}
                >
                  <SelectTrigger id="fm-transmission">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="automatic">Automática</SelectItem>
                    <SelectItem value="manual">Estándar</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm-seats">Asientos</Label>
                <Input
                  id="fm-seats"
                  type="number"
                  min={1}
                  max={15}
                  value={form.seats}
                  onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })}
                />
                {formErrors.seats && <p className="text-xs text-destructive">{formErrors.seats}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm-luggage">Maletas</Label>
                <Input
                  id="fm-luggage"
                  type="number"
                  min={0}
                  value={form.luggage}
                  onChange={(e) => setForm({ ...form, luggage: Number(e.target.value) })}
                />
                {formErrors.luggage && <p className="text-xs text-destructive">{formErrors.luggage}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm-rate">Tarifa por día (MXN)</Label>
                <Input
                  id="fm-rate"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.dailyRate}
                  onChange={(e) => setForm({ ...form, dailyRate: Number(e.target.value) })}
                />
                {formErrors.dailyRateCents && (
                  <p className="text-xs text-destructive">{formErrors.dailyRateCents}</p>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fm-photos">Fotos existentes (una URL por línea)</Label>
              <Textarea
                id="fm-photos"
                rows={3}
                placeholder={'/images/fleet/march-1.jpg\n/images/fleet/march-2.jpg'}
                value={form.photos}
                onChange={(e) => setForm({ ...form, photos: e.target.value })}
              />
            </div>
            <PhotoDropzone onFiles={addFiles} />
            {/* Preview con blob: URLs — mismas proporciones (16:10) que la
                tarjeta del catálogo; nada viaja hasta confirmar. */}
            {pendingPreviews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {pendingPreviews.map((url, i) => (
                  <div key={url} className="group relative overflow-hidden rounded-md border">
                    <img
                      src={url}
                      alt={`Nueva foto ${i + 1}`}
                      className="aspect-[16/10] w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removePending(i)}
                      className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                      aria-label={`Quitar foto ${i + 1}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="fm-plates">Placas iniciales (una por línea)</Label>
              <Textarea
                id="fm-plates"
                rows={2}
                placeholder={'YXB-1234\nYXB-1235'}
                value={form.plates}
                onChange={(e) => setForm({ ...form, plates: e.target.value })}
              />
              {formErrors.plates && <p className="text-xs text-destructive">{formErrors.plates}</p>}
            </div>
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

      {/* Confirmación de baja lógica */}
      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Dar de baja “{deleteTarget?.name}”?</DialogTitle>
            <DialogDescription>
              Dejará de cotizar y mostrarse en el catálogo; el historial de rentas se conserva
              (borrado lógico). Las unidades pueden retirarse también.
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#0e7490]"
              checked={retireUnits}
              onChange={(e) => setRetireUnits(e.target.checked)}
            />
            Retirar también sus unidades activas
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Volver
            </Button>
            <Button variant="destructive" onClick={deleteModel}>
              Dar de baja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ModelEditor — pantalla completa de edición de un modelo (montada en
// /admin/flota/[id], ya no un modal): formulario + GALERÍA de fotos con
// miniaturas, reorden drag & drop y borrado con confirmación que muestra
// la foto. Solo español.
import { useRef, useState } from 'react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog';
import { Toaster, toast } from '../../ui/sonner';
import PhotoDropzone, { GALLERY_DRAG_TYPE } from './PhotoDropzone';
import { vehicleUpsertSchema } from '../../../lib/validation';

export interface EditableModel {
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
  units: Array<{ id: number; plate: string; status: string }>;
}

const CATEGORIES = ['small', 'compact', 'medium', 'large', 'van', 'cargo'];
const CATEGORY_LABEL: Record<string, string> = {
  small: 'Chico',
  compact: 'Compacto',
  medium: 'Mediano',
  large: 'Grande',
  van: 'Van',
  cargo: 'Carga',
};

function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export default function ModelEditor({ model }: { model: EditableModel }) {
  const [name, setName] = useState(model.name);
  const [slug, setSlug] = useState(model.slug);
  const [category, setCategory] = useState(model.category);
  const [transmission, setTransmission] = useState<'automatic' | 'manual'>(model.transmission);
  const [seats, setSeats] = useState(model.seats);
  const [luggage, setLuggage] = useState(model.luggage);
  const [dailyRate, setDailyRate] = useState(model.dailyRateCents / 100);
  const [active, setActive] = useState(model.active);
  const [photos, setPhotos] = useState<string[]>(model.photos);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Preview con blob: URLs de archivos recién seleccionados (desechables).
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingPreviews, setPendingPreviews] = useState<string[]>([]);

  // Confirmación de borrado: la URL de la foto candidata.
  const [deleting, setDeleting] = useState<string | null>(null);

  // Drag & drop del reorden (HTML5 nativo, sin librerías).
  const dragFrom = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

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

  function reorder(target: number) {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragOver(null);
    if (from === null || from === target) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    try {
      const candidate = {
        slug,
        name,
        category,
        transmission,
        seats: Number(seats),
        luggage: Number(luggage),
        dailyRateCents: Math.round(Number(dailyRate) * 100),
        photos,
        active,
      };
      const parsed = vehicleUpsertSchema.safeParse(candidate);
      if (!parsed.success) {
        const next: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          if (!next[issue.path[0]]) next[issue.path[0]] = issue.message;
        }
        setErrors(next);
        return;
      }

      // Ahora sí viajan los originales pendientes (sharp en el servidor).
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

      const res = await fetch(`/api/admin/vehicles/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed.data,
          photos: [...parsed.data.photos, ...uploadedPaths],
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        toast.success('Modelo actualizado');
        window.location.href = '/admin/flota';
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; slug?: string };
      if (data.error === 'duplicate_slug') {
        setErrors({ slug: `El slug "${data.slug}" ya existe; cámbialo.` });
      } else {
        toast.error('No se pudo guardar');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Toaster />
      <form
        onSubmit={save}
        className="grid gap-8 lg:grid-cols-[2fr_3fr]"
        // Red de seguridad: cualquier drop NO manejado (p.ej. una miniatura
        // soltada fuera de la galería y de la dropzone) se mata aquí para
        // que el navegador no lo interprete (navegar a la imagen, etc.).
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        {/* Columna 1: datos del modelo */}
        <fieldset className="space-y-4 rounded-xl border bg-background p-5">
          <legend className="px-1 text-sm font-semibold">Datos del modelo</legend>
          <div className="space-y-1.5">
            <Label htmlFor="me-name">Nombre</Label>
            <Input
              id="me-name"
              value={name}
              onBlur={() => !slug && setSlug(slugify(name))}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="me-slug">Slug (URL)</Label>
            <Input id="me-slug" value={slug} onChange={(e) => setSlug(e.target.value)} />
            {errors.slug && <p className="text-xs text-destructive">{errors.slug}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="me-category">Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="me-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c] ?? c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="me-transmission">Transmisión</Label>
              <Select value={transmission} onValueChange={(v) => setTransmission(v as 'automatic' | 'manual')}>
                <SelectTrigger id="me-transmission">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="automatic">Automática</SelectItem>
                  <SelectItem value="manual">Estándar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="me-seats">Asientos</Label>
              <Input id="me-seats" type="number" min={1} max={15} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="me-luggage">Maletas</Label>
              <Input id="me-luggage" type="number" min={0} value={luggage} onChange={(e) => setLuggage(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="me-rate">Tarifa por día (MXN)</Label>
            <Input id="me-rate" type="number" min={0} step="0.01" value={dailyRate} onChange={(e) => setDailyRate(Number(e.target.value))} />
            {errors.dailyRateCents && <p className="text-xs text-destructive">{errors.dailyRateCents}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[#0e7490]"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Activo (visible en el catálogo público)
          </label>
          <div className="pt-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </Button>
          </div>
        </fieldset>

        {/* Columna 2: galería */}
        <fieldset className="space-y-4 rounded-xl border bg-background p-5">
          <legend className="px-1 text-sm font-semibold">
            Fotos ({photos.length + pendingPreviews.length})
          </legend>
          <p className="text-xs text-muted-foreground">
            Arrastra las miniaturas para reordenarlas (la primera es la principal). Pasa el cursor
            y usa la paperera para eliminar.
          </p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((url, i) => (
              <div
                key={url}
                draggable
                onDragStart={(e) => {
                  dragFrom.current = i;
                  // Firma el arrastre interno: la dropzone de carga lo ignora
                  // (arrastrar un <img> adjunta la imagen como archivo en
                  // Chromium y colaría por el guard de files).
                  e.dataTransfer.setData(GALLERY_DRAG_TYPE, String(i));
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                  setDragOver(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(i);
                }}
                onDrop={() => reorder(i)}
                className={`group relative aspect-[16/10] cursor-grab overflow-hidden rounded-lg border bg-muted active:cursor-grabbing ${
                  dragOver === i ? 'ring-2 ring-brand' : ''
                }`}
              >
                <img src={url} alt={`Foto ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                {i === 0 && photos.length > 1 && (
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">
                    Principal
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setDeleting(url)}
                  aria-label={`Eliminar foto ${i + 1}`}
                  className="absolute right-1 top-1 rounded bg-red-600 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6M10 11v6M14 11v6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            ))}

            {/* Previews pendientes (blob: locales — aún no subidas) */}
            {pendingPreviews.map((url, i) => (
              <div key={url} className="group relative aspect-[16/10] overflow-hidden rounded-lg border-2 border-dashed">
                <img src={url} alt={`Nueva foto ${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePending(i)}
                  aria-label={`Quitar foto nueva ${i + 1}`}
                  className="absolute right-1 top-1 rounded bg-red-600 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M3 6h18M8 6V4h8v2m1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <PhotoDropzone onFiles={addFiles} />
        </fieldset>
      </form>

      {/* Confirmación de borrado: se MUESTRA la foto para identificarla
          antes de confirmar (o abortar). Solo la quita del modelo; el
          archivo en disco queda (las URLs son inmutables). */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Seguro que deseas eliminar esta foto?</DialogTitle>
            <DialogDescription>La foto se quitará del modelo al guardar los cambios.</DialogDescription>
          </DialogHeader>
          {deleting !== null && (
            <img
              src={deleting}
              alt="Foto a eliminar"
              className="mx-auto aspect-[16/10] w-full max-w-sm rounded-lg border object-cover"
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setPhotos((prev) => prev.filter((p) => p !== deleting));
                setDeleting(null);
              }}
            >
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

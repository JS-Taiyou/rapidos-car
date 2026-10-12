// PhotoDropzone — zona de carga de fotos: clic (o Enter) abre el selector
// de archivos, o se sueltan archivos DENTRO del área delimitada.
//
// Convivencia con el drag & drop de reorden de la galería: los arrastres
// internos marcan dataTransfer con GALLERY_DRAG_TYPE y se ignoran por
// completo. OJO: arrastrar un <img> dentro de la página adjunta la imagen
// COMO ARCHIVO en dataTransfer.files (Chromium), así que el guard no puede
// ser "trae archivos" — tiene que ser el marcador explícito. El contador
// de dragenter/dragleave evita el parpadeo del highlight en los hijos.
import { useRef, useState } from 'react';

// Tipo MIME custom: firma los arrastres que iniciaron en la galería.
export const GALLERY_DRAG_TYPE = 'application/x-rapidos-gallery';

interface Props {
  onFiles: (files: File[]) => void;
  label?: string;
}

export default function PhotoDropzone({
  onFiles,
  label = 'Presiona para cargar fotos nuevas o suéltalas aquí',
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  const [active, setActive] = useState(false);

  function reset() {
    depth.current = 0;
    setActive(false);
  }

  function isGalleryDrag(e: React.DragEvent): boolean {
    return e.dataTransfer.types.includes(GALLERY_DRAG_TYPE);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    reset();
    if (isGalleryDrag(e)) return; // reorden de galería: nada que cargar
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) onFiles(files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        if (!isGalleryDrag(e) && e.dataTransfer.types.includes('Files')) setActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = isGalleryDrag(e) ? 'none' : 'copy';
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) reset();
      }}
      onDrop={handleDrop}
      className={`flex cursor-pointer select-none flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
        active
          ? 'border-brand bg-brand-soft/60'
          : 'border-muted-foreground/30 bg-muted/30 hover:border-brand/50 hover:bg-brand-soft/25'
      }`}
    >
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        className="text-brand"
        aria-hidden="true"
      >
        <path
          d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground/70">Máx. 6 imágenes de 10 MB · se optimizan automáticamente</p>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

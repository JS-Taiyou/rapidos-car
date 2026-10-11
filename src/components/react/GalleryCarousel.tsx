// GalleryCarousel — carrusel de la vista detallada de un modelo (/flota/[slug]).
// Auto-avanza cada intervalMs; el avance automático SE ABORTA mientras el
// cursor está encima (hover) y se reanuda al salir. Todas las fotos se
// listan abajo como miniaturas más pequeñas: clic = cambio inmediato.
// Isla chica y puntual: aquí SÍ hay interacción real (ARCHITECTURE §2.1).
import { useEffect, useState } from 'react';

interface Props {
  photos: string[];
  alt: string;
  intervalMs?: number;
}

export default function GalleryCarousel({ photos, alt, intervalMs = 4000 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || photos.length < 2) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % photos.length), intervalMs);
    return () => clearInterval(timer);
  }, [paused, photos.length, intervalMs]);

  function goTo(i: number) {
    setIndex(i);
  }

  return (
    <div
      role="region"
      aria-roledescription="carrusel"
      aria-label={`${alt}: ${photos.length} fotos`}
      className="space-y-3"
    >
      {/* Marco principal: shimmer hasta que carga la primera; todas las
          fotos apiladas con cross-fade (transition-opacity). */}
      <div
        className="img-loading relative aspect-[16/10] w-full overflow-hidden rounded-xl border"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {photos.map((photo, i) => (
          <img
            key={photo}
            src={photo}
            alt={i === 0 ? alt : `${alt} — foto ${i + 1}`}
            width="960"
            height="600"
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
              i === index ? 'opacity-100' : 'opacity-0'
            }`}
            onLoad={
              i === 0
                ? (e) => e.currentTarget.parentElement?.classList.add('is-loaded')
                : undefined
            }
          />
        ))}
        {/* Indicador de foto activa sobre el marco */}
        <span
          className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
          aria-hidden="true"
        >
          {index + 1}/{photos.length}
        </span>
      </div>

      {/* Miniaturas: TODAS las fotos (incluida la principal), más pequeñas
          que antes; clic = cambio inmediato (y el auto-avance sigue desde
          la elegida). */}
      <div className="grid grid-cols-4 gap-2">
        {photos.map((photo, i) => (
          <button
            type="button"
            key={photo}
            onClick={() => goTo(i)}
            aria-label={`Ver foto ${i + 1} de ${alt}`}
            aria-current={i === index ? 'true' : undefined}
            className={`aspect-[16/10] overflow-hidden rounded-lg border transition-shadow ${
              i === index ? 'border-brand ring-2 ring-brand' : 'border-border hover:border-brand/50'
            }`}
          >
            <img
              src={photo}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

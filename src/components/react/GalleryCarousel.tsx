// GalleryCarousel — carrusel de la vista detallada de un modelo (/flota/[slug]).
// Auto-avanza cada intervalMs; el avance SE ABORTA mientras el cursor está
// encima (hover) y se reanuda al salir. La espera se comunica con una franja
// teal de progreso que se llena horizontal dentro del marco (respetando el
// border-radius por el overflow-hidden del contenedor) — es la cuenta
// regresiva del cambio de foto. Todas las fotos se listan abajo como
// miniaturas: clic = cambio inmediato. Isla chica y puntual: aquí SÍ hay
// interacción real (ARCHITECTURE §2.1).
import { useEffect, useRef, useState } from 'react';

interface Props {
  photos: string[];
  alt: string;
  intervalMs?: number;
}

export default function GalleryCarousel({ photos, alt, intervalMs = 4000 }: Props) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // cycle fuerza re-arranque aun clickeando la miniatura ACTIVA (mismo index).
  const [cycle, setCycle] = useState(0);
  // Deadline del cambio (no un setInterval ciego): la selección manual lo
  // reinicia a tope, y el hover lo congela/reanuda sin perder lo andado —
  // así franja de progreso y slide nunca se desincronizan.
  const deadlineRef = useRef(0);

  useEffect(() => {
    if (paused || photos.length < 2) return;
    // deadline vencido (o reiniciado a mano) → ciclo nuevo de intervalMs
    if (deadlineRef.current <= Date.now()) {
      deadlineRef.current = Date.now() + intervalMs;
    }
    const timer = setTimeout(() => {
      deadlineRef.current = 0;
      setIndex((i) => (i + 1) % photos.length);
    }, deadlineRef.current - Date.now());
    return () => clearTimeout(timer);
  }, [paused, index, cycle, photos.length, intervalMs]);

  // Selección manual: la foto elegida se muestra el intervalo COMPLETO,
  // aunque quedara 0.3s del ciclo anterior.
  function goTo(i: number) {
    deadlineRef.current = 0;
    setCycle((c) => c + 1);
    setIndex(i);
  }

  return (
    <div
      role="region"
      aria-roledescription="carrusel"
      aria-label={`${alt}: ${photos.length} fotos`}
      className="space-y-3"
    >
      {/* Marco principal: shimmer sólo hasta la primera carga (el ref
          cubre el caso de imágenes eager que terminan ANTES de hidratar,
          cuando React ya no dispara onLoad). */}
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
            ref={
              i === 0
                ? (el) => {
                    if (el?.complete) el.parentElement?.classList.add('is-loaded');
                  }
                : undefined
            }
            onLoad={
              i === 0
                ? (e) => e.currentTarget.parentElement?.classList.add('is-loaded')
                : undefined
            }
          />
        ))}

        {/* Contador de foto activa */}
        <span
          className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white"
          aria-hidden="true"
        >
          {index + 1}/{photos.length}
        </span>

        {/* Franja de progreso: se llena en el tiempo del intervalo; en hover
            se congela (animation-play-state) sin perder el avance logrado.
            Re-key por slide para que cada foto reinicie el llenado. El
            overflow-hidden + rounded-xl del marco la recorta: nunca sobresale
            el border-radius. */}
        {photos.length > 1 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/25" aria-hidden="true">
            <div
              key={`${index}-${cycle}`}
              className="h-full bg-brand"
              style={{
                animation: `carousel-progress ${intervalMs}ms linear forwards`,
                animationPlayState: paused ? 'paused' : 'running',
              }}
            />
          </div>
        )}
      </div>

      {/* Miniaturas: TODAS las fotos (incluida la principal), más pequeñas.
          Hasta 6 caben en UNA fila (columnas = min(n, 6)); con 7+ se envuelven
          a la fila siguiente — nunca hay scroll. */}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(photos.length, 6)}, minmax(0, 1fr))` }}
      >
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

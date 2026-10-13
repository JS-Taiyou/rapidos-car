// DateTimeField — selector de fecha (y hora opcional) PROPIO: el popup
// nativo de <input type="datetime-local"> no es estilizable por CSS, así que
// aquí controlamos presentación — esquinas redondeadas, hover suave,
// selección en el color del tenant, AM/PM en pastilla segmentada. El valor
// viaja SIEMPRE como 'YYYY-MM-DD' o 'YYYY-MM-DDTHH:mm' (mismo contrato que
// datetime-local: cero cambios en los callers).
//
// El popover se renderiza por PORTAL en <body> con posición fixed: dentro de
// un Dialog con overflow-y-auto un popover absoluto se recorta (CSS computa
// overflow-x como auto), y anclado a la derecha se salía del modal. Con el
// portal el picker flota sobre todo, se ACOMODA SOLO hacia la izquierda o
// arriba donde cabe, sigue al trigger en scrolls internos, y sus clics no
// burbujean a document (Radix no cierra el modal por "clic fuera").
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DOW = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const POPOVER_W = 272;
const POPOVER_ESTIMATED_H = 340; // con hora; para decidir el volteo vertical
const MARGIN = 8;

const pad2 = (n: number) => String(n).padStart(2, '0');

function parseValue(v: string): { date: string; time: string } {
  const [date, time = '12:00'] = v.split('T');
  return { date: date ?? '', time };
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function todayKey(): string {
  const t = new Date();
  return dateKey(t.getFullYear(), t.getMonth(), t.getDate());
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Muestra el selector de hora (AM/PM) junto al calendario. */
  withTime?: boolean;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
}

export function DateTimeField({ value, onChange, withTime = false, ariaLabel, className, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [cursor, setCursor] = useState(() => {
    const { date } = parseValue(value);
    const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : new Date();
    return { y: base.getFullYear(), m: base.getMonth() };
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const { date: selectedDate, time } = parseValue(value);
  const [hh, mm] = time.split(':').map(Number);
  const hour12 = ((Number.isFinite(hh) ? hh : 12) % 12) || 12;
  const isPM = (hh ?? 12) >= 12;

  // Coloca el popover pegado al trigger, volteando hacia la izquierda o
  // arriba cuando no cabe — nunca excede el viewport.
  function place() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    let left = rect.left;
    if (left + POPOVER_W > window.innerWidth - MARGIN) {
      // Alineado al borde derecho del trigger (hacia la izquierda) y
      // clampeado al viewport como última instancia.
      left = Math.max(MARGIN, Math.min(rect.right - POPOVER_W, window.innerWidth - POPOVER_W - MARGIN));
    }
    let top = rect.bottom + 6;
    if (top + POPOVER_ESTIMATED_H > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, rect.top - POPOVER_ESTIMATED_H - 6);
    }
    setPos({ top, left });
  }

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    if (selectedDate && /^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
      const d = new Date(`${selectedDate}T12:00:00`);
      setCursor({ y: d.getFullYear(), m: d.getMonth() });
    }
    place();
    setOpen(true);
  }

  // Cerrar al clic fuera (el popover vive en body: se comprueba por
  // contiene, no por árbol React). Los clics DENTRO del popover ya no
  // burbujean a document (ver onPointerDown), así que no cierran nada.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Recolocar pegado al trigger en scrolls (también internos de un modal,
  // por eso capture) y al redimensionar.
  useEffect(() => {
    if (!open) return;
    document.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  const triggerLabel = useMemo(() => {
    if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return placeholder ?? 'Elegir fecha';
    const d = new Date(`${selectedDate}T12:00:00`);
    const fecha = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
    if (!withTime) return fecha;
    const hora = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true }).format(
      new Date(2000, 0, 1, hh ?? 12, mm ?? 0),
    );
    return `${fecha}, ${hora}`;
  }, [value, withTime, selectedDate, hh, mm, placeholder]);

  function emit(nextDate: string, nextTime: string) {
    onChange(withTime ? `${nextDate}T${nextTime}` : nextDate);
  }

  function pickDay(y: number, m: number, d: number) {
    const key = dateKey(y, m, d);
    emit(key, time);
    if (!withTime) setOpen(false);
  }

  function setTime(nextHour12: number, nextPM: boolean, nextMin = mm ?? 0) {
    const h24 = nextPM ? (nextHour12 % 12) + 12 : nextHour12 % 12;
    emit(selectedDate || todayKey(), `${pad2(h24)}:${pad2(nextMin)}`);
  }

  // Grilla del mes: lunes primero; celdas vacías para los días previos.
  const firstDow = (new Date(cursor.y, cursor.m, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.y, cursor.m + 1, 0).getDate();
  const cells: Array<{ d: number } | null> = [
    ...Array.from({ length: firstDow }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => ({ d: i + 1 })),
  ];
  const today = todayKey();

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(
          'flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-left text-sm shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          !value && 'text-muted-foreground',
        )}
      >
        <span className="truncate tabular-nums">{triggerLabel}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 text-muted-foreground" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="4" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={popoverRef}
            // Blindar el picker: sin esto, un clic en él cuenta como "fuera"
            // para Radix Dialog y ABORTARÍA el modal que lo contiene.
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: POPOVER_W }}
            className="z-[70] rounded-xl border bg-background p-3 shadow-lg"
            role="dialog"
            aria-label="Seleccionar fecha y hora"
          >
            {/* Mes / año */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                aria-label="Mes anterior"
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
                onClick={() => setCursor((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))}
              >
                ‹
              </button>
              <p className="text-sm font-semibold capitalize">
                {MONTHS[cursor.m]} {cursor.y}
              </p>
              <button
                type="button"
                aria-label="Mes siguiente"
                className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-accent"
                onClick={() => setCursor((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))}
              >
                ›
              </button>
            </div>

            {/* Calendario */}
            <div className="grid grid-cols-7 gap-0.5">
              {DOW.map((d) => (
                <span key={d} className="flex h-7 items-center justify-center text-[11px] font-medium text-muted-foreground">
                  {d}
                </span>
              ))}
              {cells.map((cell, i) =>
                cell === null ? (
                  <span key={`e${i}`} />
                ) : (
                  <button
                    key={cell.d}
                    type="button"
                    onClick={() => pickDay(cursor.y, cursor.m, cell.d)}
                    className={cn(
                      'flex h-9 items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                      dateKey(cursor.y, cursor.m, cell.d) === selectedDate
                        ? 'bg-brand font-semibold text-white hover:bg-brand-dark'
                        : dateKey(cursor.y, cursor.m, cell.d) === today
                          ? 'font-bold text-brand hover:bg-accent'
                          : 'hover:bg-accent',
                    )}
                  >
                    {cell.d}
                  </button>
                ),
              )}
            </div>

            {/* Hora */}
            {withTime && (
              <div className="mt-3 flex items-center justify-center gap-2 border-t pt-3">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  aria-label="Hora"
                  className="h-9 w-12 rounded-lg border text-center text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={hour12}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    if (v === '' || (Number(v) >= 1 && Number(v) <= 12)) setTime(Number(v || 1), isPM);
                  }}
                />
                <span className="text-sm font-semibold text-muted-foreground">:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={2}
                  aria-label="Minutos"
                  className="h-9 w-12 rounded-lg border text-center text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={pad2(mm ?? 0)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '');
                    if (v === '' || Number(v) <= 59) setTime(hour12, isPM, Number(v || 0));
                  }}
                />
                {/* AM/PM en pastilla segmentada */}
                <div className="flex rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Periodo">
                  {(['AM', 'PM'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={(p === 'PM') === isPM}
                      onClick={() => setTime(hour12, p === 'PM')}
                      className={cn(
                        'h-8 rounded-full px-3 text-xs font-semibold transition-colors',
                        (p === 'PM') === isPM ? 'bg-background text-brand shadow' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 flex justify-end border-t pt-2">
              <button
                type="button"
                className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                onClick={() => setOpen(false)}
              >
                Listo
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default DateTimeField;

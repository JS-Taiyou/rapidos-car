// MoneyInput — campo numérico de dinero: el '$' vive DENTRO del input como
// texto decorativo (no viaja al backend) y la rueda del mouse NO cambia el
// valor (el accidente clásico al hacer scroll en un formulario). Para campos
// numéricos no monetarios (odómetro) se usa con prefix=''.
import { useEffect, useRef, type ComponentProps } from 'react';
import { Input } from './input';
import { cn } from '../../lib/utils';

interface MoneyInputProps extends Omit<ComponentProps<'input'>, 'type'> {
  /** Prefijo decorativo dentro del input. '' = sin símbolo. */
  prefix?: string;
  /** Sufijo decorativo (ej. 'km'). */
  suffix?: string;
}

export function MoneyInput({ prefix = '$', suffix, className, ...props }: MoneyInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  // La rueda sólo se bloquea CON el input enfocado: addEventListener
  // no-passive (los onWheel de React son passive y no permiten preventDefault).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div className="relative w-full">
      {prefix !== '' && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {prefix}
        </span>
      )}
      <Input
        ref={ref}
        type="number"
        className={cn(
          prefix !== '' && 'pl-7',
          suffix && 'pr-10',
          className,
        )}
        {...props}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

export default MoneyInput;

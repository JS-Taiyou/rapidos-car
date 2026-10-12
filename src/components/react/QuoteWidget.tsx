// Cotizador del hero (spec §3.1): zona de entrega + salida + regreso. NO
// cotiza nada: valida lo mínimo y navega a /reservar (o /en/book) con los
// valores en query params, donde BookingFlow hace el trabajo real.
import { useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { useTranslations, type Lang } from '../../i18n/utils';

interface Props {
  lang: Lang;
  zones: Array<{ zone: string; name?: string; feeCents: number }>;
}

// datetime-local exige 'YYYY-MM-DDTHH:mm' exacto; toISOString() NO sirve
// (devuelve UTC).
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const feeFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

export default function QuoteWidget({ lang, zones }: Props) {
  const t = useTranslations(lang);
  const [pickupZone, setPickupZone] = useState('');
  const [returnZone, setReturnZone] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState<string | null>(null);

  const zoneLabel = (z: { zone: string; name?: string }) =>
    z.name ?? t(`quote.zones.${z.zone}`);
  const zoneTouched = (z: { zone: string; feeCents: number }) => {
    if (pickupZone && z.zone === pickupZone && returnZone && z.zone !== returnZone) return true;
    if (returnZone && z.zone === returnZone && pickupZone && z.zone !== pickupZone) return true;
    return false;
  };

  // Bloquea fechas pasadas antes de cualquier JS (atributo min de ambos
  // inputs). Lead time del negocio: 3 h.
  const minDateTime = useMemo(() => toLocalInput(new Date(Date.now() + 3 * 60 * 60 * 1000)), []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // El disabled es UX, no validación: revalidar siempre.
    if (!pickupZone || !start || !end) {
      setError(t('quote.error.required'));
      return;
    }
    // Strings de ancho fijo: comparación lexicográfica válida.
    if (end <= start) {
      setError(t('quote.error.endBeforeStart'));
      return;
    }
    if (start < minDateTime) {
      setError(t('quote.error.tooSoon'));
      return;
    }
    setError(null);
    // Navegación dura, no router: home y /reservar son páginas MPA distintas.
    const params = new URLSearchParams({ start, end, zone: pickupZone });
    window.location.href = `${lang === 'en' ? '/en/book' : '/reservar'}?${params.toString()}`;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full rounded-xl border border-border/60 bg-background/95 p-4 shadow-lg backdrop-blur sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="qw-zone">{t('quote.pickupZone')}</Label>
          <Select value={pickupZone} onValueChange={setPickupZone}>
            <SelectTrigger id="qw-zone">
              <SelectValue placeholder={t('quote.pickupZone')} />
            </SelectTrigger>
            <SelectContent>
              {zones.map((z) => (
                <SelectItem key={z.zone} value={z.zone}>
                  {t(`quote.zones.${z.zone}`)}
                  {z.feeCents > 0 ? ` (+${feeFmt.format(z.feeCents / 100)})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qw-start">{t('quote.pickupDate')}</Label>
          <Input
            id="qw-start"
            type="datetime-local"
            value={start}
            min={minDateTime}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="qw-end">{t('quote.returnDate')}</Label>
          <Input
            id="qw-end"
            type="datetime-local"
            value={end}
            min={minDateTime}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <small className="text-xs text-muted-foreground">{t('quote.timezoneNote')}</small>
        <Button type="submit" className="sm:w-auto" disabled={!pickupZone || !start || !end}>
          {t('quote.submit')}
        </Button>
      </div>
    </form>
  );
}

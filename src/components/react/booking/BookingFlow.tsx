// BookingFlow — el motor de reservación (spec §3.3, corazón del MVP).
// Wizard de 6 pasos montado en /reservar y /en/book con client:load; lee los
// query params ?start&end&zone&model que QuoteWidget o /flota/[slug] dejan
// en la URL (la URL es el estado compartible).
//
// Estado con useReducer como máquina de estados (§2.8): el funnel tiene
// transiciones válidas, datos que dependen de pasos previos y reintentos
// (un 409 regresa al paso 2). El reducer es PURO (testeable sin DOM); la
// impureza (fetch, Date.now) vive en los componentes. react-hook-form SOLO
// en el paso 4; los pasos 1-3 son selects/botones que el reducer valida por
// construcción. SIN store global: la fuente de verdad es el servidor (§2.9).
import {
  useReducer,
  useContext,
  createContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Calendar } from '../../ui/calendar';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import { Card, CardContent } from '../../ui/card';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { Toaster, toast } from '../../ui/sonner';
import { useTranslations, type Lang } from '../../../i18n/utils';
import { customerSchema, type CustomerInput } from '../../../lib/validation';
import type { PriceBreakdown, Extra } from '../../../lib/pricing';
import { es as esLocale, enUS } from 'date-fns/locale';

interface Props {
  lang: Lang;
  zones: Array<{ zone: string; feeCents: number }>;
}

type QuoteResult = {
  slug: string;
  name: string;
  category: string;
  transmission: string;
  seats: number;
  luggage: number;
  dailyRateCents: number;
  photos: string[];
  unitsAvailable: number;
  price: PriceBreakdown;
};

type Step = 'range' | 'car' | 'extras' | 'customer' | 'payment' | 'done';

interface BookingState {
  step: Step;
  range: { start: Date; end: Date } | null;
  pickupZone: string;
  quote: QuoteResult[] | null;
  extrasCatalog: Extra[];
  quoteToken: number;
  selectedModel: QuoteResult | null;
  selectedExtras: Array<{ id: number; qty: number }>;
  customer: CustomerInput | null;
  depositType: 'deposit' | 'on_pickup' | null;
  confirmation: { code: string; whatsappUrl: string } | null;
  status: 'idle' | 'quoting' | 'submitting' | 'error';
  error: string | null;
}

type Action =
  | { type: 'SET_RANGE'; start: Date; end: Date; zone: string }
  | { type: 'QUOTE_LOADED'; quote: QuoteResult[]; extrasCatalog: Extra[] }
  | { type: 'QUOTE_FAILED'; message: string }
  | { type: 'SELECT_MODEL'; model: QuoteResult }
  | { type: 'TOGGLE_EXTRA'; extraId: number }
  | { type: 'SET_EXTRA_QTY'; extraId: number; qty: number }
  | { type: 'SET_CUSTOMER'; customer: CustomerInput }
  | { type: 'SET_DEPOSIT'; depositType: 'deposit' | 'on_pickup' }
  | { type: 'SUBMITTED'; code: string; whatsappUrl: string }
  | { type: 'CONFLICT' }
  | { type: 'NEXT' }
  | { type: 'BACK' };

const STEP_ORDER: Step[] = ['range', 'car', 'extras', 'customer', 'payment', 'done'];

const initialState: BookingState = {
  step: 'range',
  range: null,
  pickupZone: '',
  quote: null,
  extrasCatalog: [],
  quoteToken: 0,
  selectedModel: null,
  selectedExtras: [],
  customer: null,
  depositType: null,
  confirmation: null,
  status: 'idle',
  error: null,
};

function bookingReducer(state: BookingState, action: Action): BookingState {
  switch (action.type) {
    case 'SET_RANGE':
      // Rango nuevo = cotización vieja inválida: quote null y status
      // quoting; el useEffect reacciona.
      return {
        ...state,
        step: 'range',
        range: { start: action.start, end: action.end },
        pickupZone: action.zone,
        quote: null,
        quoteToken: state.quoteToken + 1,
        selectedModel: null,
        status: 'quoting',
        error: null,
      };
    case 'QUOTE_LOADED':
      return {
        ...state,
        quote: action.quote,
        extrasCatalog: action.extrasCatalog,
        // 0 modelos: quedarse en 'range' con error "sin disponibilidad".
        step: action.quote.length > 0 ? 'car' : 'range',
        status: 'idle',
        error: action.quote.length > 0 ? null : state.error ?? 'sin_disponibilidad',
      };
    case 'QUOTE_FAILED':
      return { ...state, status: 'error', error: action.message };
    case 'SELECT_MODEL':
      return { ...state, selectedModel: action.model, step: 'extras' };
    case 'TOGGLE_EXTRA': {
      const exists = state.selectedExtras.some((e) => e.id === action.extraId);
      return {
        ...state,
        selectedExtras: exists
          ? state.selectedExtras.filter((e) => e.id !== action.extraId)
          : [...state.selectedExtras, { id: action.extraId, qty: 1 }],
      };
    }
    case 'SET_EXTRA_QTY':
      return {
        ...state,
        selectedExtras: state.selectedExtras.map((e) =>
          e.id === action.extraId ? { ...e, qty: Math.max(1, action.qty) } : e,
        ),
      };
    case 'SET_CUSTOMER':
      return { ...state, customer: action.customer, step: 'payment' };
    case 'SET_DEPOSIT':
      return { ...state, depositType: action.depositType };
    case 'SUBMITTED':
      return {
        ...state,
        step: 'done',
        status: 'idle',
        confirmation: { code: action.code, whatsappUrl: action.whatsappUrl },
      };
    case 'CONFLICT':
      // La unidad ya no está: al paso de autos y re-cotización forzada.
      return {
        ...state,
        step: 'car',
        selectedModel: null,
        quoteToken: state.quoteToken + 1,
        status: 'quoting',
      };
    case 'BACK': {
      // Retrocede sin borrar datos (UX: nunca castigar).
      const idx = STEP_ORDER.indexOf(state.step);
      if (idx <= 0) return state;
      return { ...state, step: STEP_ORDER[idx - 1] };
    }
    case 'NEXT': {
      const idx = STEP_ORDER.indexOf(state.step);
      if (idx < 0 || idx >= STEP_ORDER.length - 1) return state;
      return { ...state, step: STEP_ORDER[idx + 1] };
    }
    default:
      return state;
  }
}

// Context del dispatch hacia los sub-pasos: evita prop-drilling sin librerías.
const BookingDispatchContext = createContext<(a: Action) => void>(() => {});
function useDispatch() {
  return useContext(BookingDispatchContext);
}

const moneyFmt = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
function money(cents: number): string {
  return moneyFmt.format(cents / 100);
}

// ---------------------------------------------------------------------------
// PASO 1 — Fechas y zona (Calendar rango + horas)
// ---------------------------------------------------------------------------
function RangeStep({ lang, zones, state }: { lang: Lang; zones: Props['zones']; state: BookingState }) {
  const t = useTranslations(lang);
  const dispatch = useDispatch();
  const [pickDate, setPickDate] = useState<Date | undefined>();
  const [returnDate, setReturnDate] = useState<Date | undefined>();
  const [pickTime, setPickTime] = useState('12:00');
  const [returnTime, setReturnTime] = useState('12:00');
  const [zone, setZone] = useState(state.pickupZone);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!pickDate || !returnDate || !zone) {
      setError(t('quote.error.required'));
      return;
    }
    const [ph, pm] = pickTime.split(':').map(Number);
    const [rh, rm] = returnTime.split(':').map(Number);
    const start = new Date(pickDate);
    start.setHours(ph, pm, 0, 0);
    const end = new Date(returnDate);
    end.setHours(rh, rm, 0, 0);
    if (end <= start) {
      setError(t('booking.range.endBeforeStart'));
      return;
    }
    if (start.getTime() < Date.now() + 3 * 60 * 60 * 1000) {
      setError(t('booking.range.tooSoon'));
      return;
    }
    if (end.getTime() - start.getTime() > 60 * 86_400_000) {
      setError(t('booking.range.tooLong'));
      return;
    }
    setError(null);
    dispatch({ type: 'SET_RANGE', start, end, zone });
  }

  return (
    <section className="space-y-6">
      <h2 className="text-xl font-semibold">{t('booking.range.title')}</h2>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex justify-center">
          <Calendar
            mode="range"
            locale={lang === 'es' ? esLocale : enUS}
            selected={{ from: pickDate, to: returnDate }}
            onSelect={(range) => {
              setPickDate(range?.from);
              setReturnDate(range?.to);
            }}
            disabled={{ before: new Date() }}
            numberOfMonths={1}
          />
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bf-picktime">{t('booking.range.pickTime')}</Label>
              <Input
                id="bf-picktime"
                type="time"
                value={pickTime}
                onChange={(e) => setPickTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bf-returntime">{t('booking.range.returnTime')}</Label>
              <Input
                id="bf-returntime"
                type="time"
                value={returnTime}
                onChange={(e) => setReturnTime(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bf-zone">{t('booking.range.zone')}</Label>
            <Select value={zone} onValueChange={setZone}>
              <SelectTrigger id="bf-zone">
                <SelectValue placeholder={t('booking.range.zone')} />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.zone} value={z.zone}>
                    {t(`quote.zones.${z.zone}`)}
                    {z.feeCents > 0 ? ` (+${money(z.feeCents)})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <small className="block text-xs text-muted-foreground">{t('quote.timezoneNote')}</small>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button onClick={submit} className="w-full sm:w-auto">
            {t('booking.range.submit')}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PASO 2 — Autos disponibles con precio TOTAL
// ---------------------------------------------------------------------------
function CarStep({ lang, state }: { lang: Lang; state: BookingState }) {
  const t = useTranslations(lang);
  const dispatch = useDispatch();

  if (state.status === 'quoting' && !state.quote) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t('booking.car.title')}</h2>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl border bg-muted/50" />
        ))}
      </section>
    );
  }

  if (!state.quote || state.quote.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">{t('booking.car.title')}</h2>
        <p className="text-muted-foreground">{t('booking.car.empty')}</p>
        <Button variant="outline" onClick={() => dispatch({ type: 'BACK' })}>
          {t('booking.back')}
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{t('booking.car.title')}</h2>
      <div className="grid gap-4">
        {state.quote.map((model) => (
          <Card key={model.slug} data-slug={model.slug}>
            <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
              <div className="flex h-28 w-full shrink-0 items-center justify-center rounded-lg bg-muted text-4xl sm:w-44">
                🚗
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{model.name}</h3>
                  <Badge variant="secondary">{t(`fleet.category.${model.category}`)}</Badge>
                  <Badge variant="outline">
                    {model.unitsAvailable}{' '}
                    {model.unitsAvailable === 1
                      ? t('booking.car.unitsSingular')
                      : t('booking.car.unitsPlural')}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {model.seats} {t('fleet.specs.seats')} · {model.luggage}{' '}
                  {t('fleet.specs.luggage')} · {t(`fleet.transmission.${model.transmission}`)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {model.price.daysCount} {t('booking.car.days')} ·{' '}
                  {model.price.discountPct > 0 &&
                    `−${model.price.discountPct}% · `}
                  {t('booking.summary.delivery')} {money(model.price.deliveryFeeCents)}
                </p>
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <p className="text-2xl font-bold text-brand">{money(model.price.totalCents)}</p>
                <Button onClick={() => dispatch({ type: 'SELECT_MODEL', model })}>
                  {t('booking.car.select')}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Button variant="outline" onClick={() => dispatch({ type: 'BACK' })}>
        {t('booking.back')}
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PASO 3 — Extras (total estimado en vivo con useMemo, NO estado nuevo)
// ---------------------------------------------------------------------------
function ExtrasStep({ lang, state }: { lang: Lang; state: BookingState }) {
  const t = useTranslations(lang);
  const dispatch = useDispatch();
  const model = state.selectedModel!;

  // Estimación en cliente: el servidor recalcula al reservar (§2.9).
  const extrasEstimate = useMemo(() => {
    let cents = model.price.extrasCents;
    for (const sel of state.selectedExtras) {
      const extra = state.extrasCatalog.find((e) => e.id === sel.id);
      if (!extra) continue;
      cents += extra.per === 'day'
        ? extra.priceCents * sel.qty * model.price.daysCount
        : extra.priceCents * sel.qty;
    }
    return model.price.subtotalCents + cents + model.price.deliveryFeeCents + model.price.taxCents;
  }, [state.selectedExtras, state.extrasCatalog, model]);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{t('booking.extras.title')}</h2>
      {state.extrasCatalog.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('booking.extras.none')}</p>
      ) : (
        <ul className="divide-y rounded-xl border">
          {state.extrasCatalog.map((extra) => {
            const selected = state.selectedExtras.find((e) => e.id === extra.id);
            return (
              <li key={extra.id} className="flex items-center gap-3 p-3">
                <input
                  type="checkbox"
                  id={`extra-${extra.id}`}
                  className="h-4 w-4 accent-[#0e7490]"
                  checked={!!selected}
                  onChange={() => dispatch({ type: 'TOGGLE_EXTRA', extraId: extra.id })}
                />
                <div className="flex-1">
                  <label htmlFor={`extra-${extra.id}`} className="cursor-pointer text-sm font-medium">
                    {extra.name}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {money(extra.priceCents)}
                    {extra.per === 'day' ? t('booking.extras.perDay') : t('booking.extras.perRental')}
                  </p>
                </div>
                {selected && (
                  <div className="flex items-center gap-1">
                    <label className="sr-only" htmlFor={`qty-${extra.id}`}>
                      {t('booking.extras.qty')}
                    </label>
                    <input
                      id={`qty-${extra.id}`}
                      type="number"
                      min={1}
                      max={9}
                      className="h-8 w-16 rounded-md border px-2 text-sm"
                      value={selected.qty}
                      onChange={(e) =>
                        dispatch({
                          type: 'SET_EXTRA_QTY',
                          extraId: extra.id,
                          qty: parseInt(e.target.value || '1', 10),
                        })
                      }
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-sm font-medium">
        {t('booking.extras.estimate')}: <span className="text-brand">{money(extrasEstimate)}</span>
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => dispatch({ type: 'BACK' })}>
          {t('booking.back')}
        </Button>
        <Button onClick={() => dispatch({ type: 'NEXT' })}>
          {t('booking.customer.submit')}
        </Button>
      </div>
    </section>
  );
}

const emptyCustomer: CustomerInput = { name: '', email: '', phone: '' };

// ---------------------------------------------------------------------------
// PASO 4 — Datos del cliente (ÚNICO paso con react-hook-form)
// ---------------------------------------------------------------------------
function CustomerStep({ lang, state }: { lang: Lang; state: BookingState }) {
  const t = useTranslations(lang);
  const dispatch = useDispatch();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CustomerInput>({
    resolver: zodResolver(customerSchema),
    defaultValues: state.customer ?? emptyCustomer,
  });

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{t('booking.customer.title')}</h2>
      <form noValidate onSubmit={handleSubmit((customer) => dispatch({ type: 'SET_CUSTOMER', customer }))} className="max-w-md space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="bf-name">{t('booking.customer.name')}</Label>
          <Input id="bf-name" autoComplete="name" {...register('name')} />
          {errors.name && <p role="alert" className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bf-email">{t('booking.customer.email')}</Label>
          <Input id="bf-email" type="email" autoComplete="email" {...register('email')} />
          {errors.email && <p role="alert" className="text-xs text-destructive">{errors.email.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bf-phone">{t('booking.customer.phone')}</Label>
          <Input id="bf-phone" type="tel" autoComplete="tel" {...register('phone')} />
          {errors.phone && <p role="alert" className="text-xs text-destructive">{errors.phone.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bf-flight">{t('booking.customer.flightNumber')}</Label>
          <Input id="bf-flight" placeholder="AM405" {...register('flightNumber')} />
          <p className="text-xs text-muted-foreground">{t('booking.customer.flightHint')}</p>
          {errors.flightNumber && (
            <p role="alert" className="text-xs text-destructive">{errors.flightNumber.message}</p>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => dispatch({ type: 'BACK' })}>
            {t('booking.back')}
          </Button>
          <Button type="submit">{t('booking.customer.submit')}</Button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PASO 5 — Depósito o pago en mostrador + resumen
// ---------------------------------------------------------------------------
function PaymentStep({ lang, state, onSubmit }: { lang: Lang; state: BookingState; onSubmit: (depositType: 'deposit' | 'on_pickup') => void }) {
  const t = useTranslations(lang);
  const dispatch = useDispatch();
  const model = state.selectedModel!;
  const deposit = state.depositType ?? 'deposit';

  const rows: Array<[string, string]> = [
    [t('booking.summary.days'), `${model.price.daysCount}`],
    [t('booking.summary.extras'), money(model.price.extrasCents)],
    [t('booking.summary.delivery'), money(model.price.deliveryFeeCents)],
    [t('booking.summary.taxes'), money(model.price.taxCents)],
  ];
  if (model.price.discountPct > 0) {
    rows.splice(1, 0, [t('booking.summary.discount'), `−${model.price.discountPct}%`]);
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">{t('booking.payment.title')}</h2>
      <dl className="max-w-md space-y-1 rounded-xl border p-4 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 text-base font-bold">
          <dt>{t('booking.summary.total')}</dt>
          <dd className="text-brand">{money(model.price.totalCents)}</dd>
        </div>
      </dl>
      <fieldset className="max-w-md space-y-2">
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
            deposit === 'deposit' ? 'border-brand bg-brand-soft/40' : ''
          }`}
        >
          <input
            type="radio"
            name="deposit"
            className="mt-1 accent-[#0e7490]"
            checked={deposit === 'deposit'}
            onChange={() => dispatch({ type: 'SET_DEPOSIT', depositType: 'deposit' })}
          />
          <span>
            <span className="block text-sm font-medium">{t('booking.payment.deposit')}</span>
            <span className="block text-xs text-muted-foreground">
              {t('booking.payment.depositDesc')} ({money(model.price.depositCents)})
            </span>
          </span>
        </label>
        <label
          className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${
            deposit === 'on_pickup' ? 'border-brand bg-brand-soft/40' : ''
          }`}
        >
          <input
            type="radio"
            name="deposit"
            className="mt-1 accent-[#0e7490]"
            checked={deposit === 'on_pickup'}
            onChange={() => dispatch({ type: 'SET_DEPOSIT', depositType: 'on_pickup' })}
          />
          <span>
            <span className="block text-sm font-medium">{t('booking.payment.onPickup')}</span>
            <span className="block text-xs text-muted-foreground">
              {t('booking.payment.onPickupDesc')}
            </span>
          </span>
        </label>
      </fieldset>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => dispatch({ type: 'BACK' })}>
          {t('booking.back')}
        </Button>
        <Button onClick={() => onSubmit(deposit)} disabled={state.status === 'submitting'}>
          {state.status === 'submitting'
            ? t('booking.payment.submitting')
            : t('booking.payment.confirm')}
        </Button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// PASO 6 — Confirmación con código + WhatsApp
// ---------------------------------------------------------------------------
function DoneStep({ lang, state }: { lang: Lang; state: BookingState }) {
  const t = useTranslations(lang);
  const confirmation = state.confirmation!;
  const model = state.selectedModel!;

  return (
    <section className="space-y-4 text-center">
      <h2 className="text-xl font-semibold">{t('booking.done.title')}</h2>
      <p className="text-sm text-muted-foreground">{t('booking.codeLabel')}</p>
      <p className="font-mono text-3xl font-bold tracking-widest text-brand">
        {confirmation.code}
      </p>
      <p className="mx-auto max-w-md text-sm text-muted-foreground">
        {t('booking.done.instructions')}
      </p>
      <div className="mx-auto max-w-md rounded-xl border p-4 text-left text-sm">
        <p className="font-medium">{model.name}</p>
        <p className="text-muted-foreground">
          {t('booking.summary.total')}: {money(model.price.totalCents)}
        </p>
      </div>
      <Button asChild className="bg-[#25D366] hover:bg-[#25D366]/90">
        <a href={confirmation.whatsappUrl} target="_blank" rel="noopener">
          {t('booking.whatsappCta')}
        </a>
      </Button>
    </section>
  );
}

// Barra de progreso: puramente derivada del estado (fuera del reducer).
function ProgressBar({ lang, step }: { lang: Lang; step: Step }) {
  const t = useTranslations(lang);
  const labels: Record<Step, string> = {
    range: t('booking.steps.range'),
    car: t('booking.steps.car'),
    extras: t('booking.steps.extras'),
    customer: t('booking.steps.customer'),
    payment: t('booking.steps.payment'),
    done: t('booking.steps.done'),
  };
  const current = STEP_ORDER.indexOf(step);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-1.5 text-xs">
      {STEP_ORDER.map((s, i) => (
        <li key={s}>
          <Badge variant={i < current ? 'success' : i === current ? 'default' : 'outline'}>
            {i + 1}. {labels[s]}
          </Badge>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Isla raíz
// ---------------------------------------------------------------------------
export default function BookingFlow({ lang, zones }: Props) {
  const [state, dispatch] = useReducer(bookingReducer, initialState);
  const t = useTranslations(lang);

  // Al montar: leer query params que QuoteWidget o /flota/[slug] dejaron en
  // la URL (?start&end&zone en formato datetime-local). El "model" solo
  // pre-seleccionaría tras cargar la cotización; el wizard funciona sin él.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const startRaw = params.get('start');
    const endRaw = params.get('end');
    const zone = params.get('zone');
    if (!startRaw || !endRaw || !zone) return;
    const start = new Date(startRaw);
    const end = new Date(endRaw);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    if (end <= start || start.getTime() < Date.now() + 3 * 60 * 60 * 1000) return;
    dispatch({ type: 'SET_RANGE', start, end, zone });
  }, []);

  // Efecto único de cotización: observa [range, pickupZone, token] con
  // AbortController — la respuesta vieja no debe pisar la nueva.
  useEffect(() => {
    if (!state.range || state.step === 'done') return;
    const ac = new AbortController();
    const { start, end } = state.range;
    (async () => {
      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start: start.toISOString(),
            end: end.toISOString(),
            pickupZone: state.pickupZone,
          }),
          signal: ac.signal,
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as {
          results: QuoteResult[];
          extras: Extra[];
        };
        dispatch({ type: 'QUOTE_LOADED', quote: data.results, extrasCatalog: data.extras });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        dispatch({ type: 'QUOTE_FAILED', message: 'network' });
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.range, state.pickupZone, state.quoteToken]);

  // Envío de la reservación: handler en el componente, NO en el reducer.
  // Por qué re-enviar todo y no un "quoteId": sin pagos no hay nada que
  // amarrar la cotización; el servidor recalcula y decide (§2.9).
  async function submitBooking(depositType: 'deposit' | 'on_pickup') {
    if (!state.range || !state.selectedModel || !state.customer) return;
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelSlug: state.selectedModel.slug,
          start: state.range.start.toISOString(),
          end: state.range.end.toISOString(),
          pickupZone: state.pickupZone,
          extras: state.selectedExtras,
          customer: state.customer,
          depositType,
          lang,
        }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as {
          booking: { code: string };
          whatsappUrl: string;
        };
        dispatch({ type: 'SUBMITTED', code: data.booking.code, whatsappUrl: data.whatsappUrl });
        return;
      }
      if (res.status === 409) {
        // Alguien ganó la unidad: toast + regreso al paso de autos.
        toast.warning(t('booking.conflict'));
        dispatch({ type: 'CONFLICT' });
        return;
      }
      if (res.status === 400) {
        const data = (await res.json().catch(() => ({ issues: [] }))) as {
          issues?: Array<{ message: string }>;
        };
        toast.error(data.issues?.[0]?.message ?? t('booking.error'));
        return;
      }
      toast.error(t('booking.error'));
    } catch {
      toast.error(t('booking.error'));
    }
  }

  const steps: Record<Step, ReactNode> = {
    range: <RangeStep lang={lang} zones={zones} state={state} />,
    car: <CarStep lang={lang} state={state} />,
    extras: <ExtrasStep lang={lang} state={state} />,
    customer: <CustomerStep lang={lang} state={state} />,
    payment: <PaymentStep lang={lang} state={state} onSubmit={submitBooking} />,
    done: <DoneStep lang={lang} state={state} />,
  };

  return (
    <BookingDispatchContext.Provider value={dispatch}>
      <Toaster />
      {state.step !== 'done' && <ProgressBar lang={lang} step={state.step} />}
      {steps[state.step]}
    </BookingDispatchContext.Provider>
  );
}

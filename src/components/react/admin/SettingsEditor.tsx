// SettingsEditor — Ajustes del tenant (spec §4.5): identidad (nombre, email,
// domicilio, teléfonos múltiples), mensajería (WhatsApp público/staff y
// Messenger — vacíos ocultan los botones del sitio) y apariencia (logo:
// icono preset con color, o imagen subida vía dest=logo). Solo español.
import { useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Toaster, toast } from '../../ui/sonner';
import PhotoDropzone from './PhotoDropzone';

interface TenantLogo {
  type: 'icon' | 'image';
  icon: 'bolt' | 'car' | 'key' | 'pin';
  color: string;
  url?: string;
}

export interface EditableTenant {
  name: string;
  email: string;
  phones: string[];
  address: string;
  publicWhatsapp: string;
  staffWhatsapp: string;
  messengerUrl: string;
  logo: TenantLogo;
}

const ICON_PATHS: Record<string, string> = {
  bolt: 'M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z',
  car: 'M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11m-14 0h14a2 2 0 0 1 2 2v4a1 1 0 0 1-1 1h-1a2 2 0 1 1-4 0H9a2 2 0 1 1-4 0H4a1 1 0 0 1-1-1v-4a2 2 0 0 1 2-2Z',
  key: 'M14 7a4 4 0 1 1-3.5 5.9L4 19.4V21H2v-2l6.1-6.5A4 4 0 0 1 14 7Z',
  pin: 'M12 21s-7-5.3-7-11a7 7 0 1 1 14 0c0 5.7-7 11-7 11Z',
};
const COLORS = ['#0e7490', '#d97706', '#e11d48', '#0284c7', '#059669', '#475569'];
const ICON_NAMES: Record<string, string> = { bolt: 'Rayo', car: 'Auto', key: 'Llave', pin: 'Pin' };

export default function SettingsEditor({ tenant }: { tenant: EditableTenant }) {
  const [form, setForm] = useState({
    name: tenant.name,
    email: tenant.email,
    address: tenant.address,
    phones: tenant.phones.length > 0 ? tenant.phones : [''],
    publicWhatsapp: tenant.publicWhatsapp,
    staffWhatsapp: tenant.staffWhatsapp,
    messengerUrl: tenant.messengerUrl,
  });
  const [logo, setLogo] = useState<TenantLogo>(tenant.logo);
  const [saving, setSaving] = useState(false);

  function setPhone(i: number, value: string) {
    setForm((f) => ({ ...f, phones: f.phones.map((p, j) => (j === i ? value : p)) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim() || null,
          address: form.address.trim() || null,
          phones: form.phones.map((p) => p.trim()).filter(Boolean),
          publicWhatsapp: form.publicWhatsapp.trim(),
          staffWhatsapp: form.staffWhatsapp.trim(),
          messengerUrl: form.messengerUrl.trim(),
          logo,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        toast.success('Ajustes guardados — el sitio ya refleja los cambios');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { issues?: Array<{ message: string }> };
      toast.error(data.issues?.[0]?.message ?? 'Revisa los campos');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Toaster />
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Identidad ---------- */}
        <fieldset className="space-y-4 rounded-xl border bg-background p-5">
          <legend className="px-1 text-sm font-semibold">Identidad del negocio</legend>
          <div className="space-y-1.5">
            <Label htmlFor="st-name">Nombre</Label>
            <Input id="st-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-email">Email</Label>
            <Input id="st-email" type="email" placeholder="hola@negocio.mx" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-address">Domicilio</Label>
            <Input id="st-address" placeholder="Calle, colonia, ciudad" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Teléfonos</Label>
            {form.phones.map((phone, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={phone}
                  placeholder="(999) 123 4567"
                  onChange={(e) => setPhone(i, e.target.value)}
                  aria-label={`Teléfono ${i + 1}`}
                />
                {form.phones.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, phones: f.phones.filter((_, j) => j !== i) }))}
                    aria-label={`Quitar teléfono ${i + 1}`}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
            {form.phones.length < 5 && (
              <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...f, phones: [...f.phones, ''] }))}>
                + Agregar teléfono
              </Button>
            )}
          </div>
        </fieldset>

        {/* ---------- Mensajería ---------- */}
        <fieldset className="space-y-4 rounded-xl border bg-background p-5">
          <legend className="px-1 text-sm font-semibold">Mensajería</legend>
          <div className="space-y-1.5">
            <Label htmlFor="st-wa-pub">WhatsApp público (CTAs del sitio)</Label>
            <Input
              id="st-wa-pub"
              inputMode="numeric"
              placeholder="5219991234567"
              className="font-mono"
              value={form.publicWhatsapp}
              onChange={(e) => setForm({ ...form, publicWhatsapp: e.target.value.replace(/\D/g, '') })}
            />
            <p className="text-xs text-muted-foreground">
              10-15 dígitos con código de país. Vacío = ocultar los botones de WhatsApp del sitio.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-wa-staff">WhatsApp del staff (confirmaciones)</Label>
            <Input
              id="st-wa-staff"
              inputMode="numeric"
              placeholder="5219991234567"
              className="font-mono"
              value={form.staffWhatsapp}
              onChange={(e) => setForm({ ...form, staffWhatsapp: e.target.value.replace(/\D/g, '') })}
            />
            <p className="text-xs text-muted-foreground">La cuenta que recibe el mensaje de confirmación del cliente al reservar.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-msn">Facebook Messenger</Label>
            <Input
              id="st-msn"
              type="url"
              placeholder="https://m.me/mipagina"
              value={form.messengerUrl}
              onChange={(e) => setForm({ ...form, messengerUrl: e.target.value.trim() })}
            />
            <p className="text-xs text-muted-foreground">Vacío = sin botón de Messenger en el sitio.</p>
          </div>
        </fieldset>

        {/* ---------- Apariencia ---------- */}
        <fieldset className="space-y-4 rounded-xl border bg-background p-5 lg:col-span-2">
          <legend className="px-1 text-sm font-semibold">Logo</legend>
          <div className="flex flex-wrap items-center gap-4">
            {/* Vista previa */}
            <div className="flex h-14 w-14 items-center justify-center rounded-lg border bg-muted/40">
              {logo.type === 'image' && logo.url ? (
                <img src={logo.url} alt="Logo" className="h-10 w-10 object-contain" />
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d={ICON_PATHS[logo.icon]} style={{ fill: logo.color }} />
                </svg>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                type="button"
                size="sm"
                variant={logo.type === 'icon' ? 'default' : 'outline'}
                onClick={() => setLogo({ type: 'icon', icon: logo.icon, color: logo.color })}
              >
                Icono
              </Button>
              <Button
                type="button"
                size="sm"
                variant={logo.type === 'image' ? 'default' : 'outline'}
                onClick={() => setLogo({ type: 'image', icon: logo.icon, color: logo.color, url: logo.url })}
              >
                Imagen
              </Button>
            </div>
          </div>

          {logo.type === 'icon' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Icono</Label>
                <div className="flex gap-2">
                  {(Object.keys(ICON_PATHS) as Array<keyof typeof ICON_PATHS>).map((key) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setLogo({ ...logo, icon: key as TenantLogo['icon'] })}
                      aria-label={ICON_NAMES[key]}
                      aria-pressed={logo.icon === key}
                      className={`flex h-11 w-11 items-center justify-center rounded-lg border transition-colors ${
                        logo.icon === key ? 'border-brand ring-2 ring-brand' : 'border-border hover:border-brand/40'
                      }`}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d={ICON_PATHS[key]} style={{ fill: logo.color }} />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex gap-2">
                  {COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setLogo({ ...logo, color: c })}
                      aria-label={`Color ${c}`}
                      aria-pressed={logo.color === c}
                      className={`h-9 w-9 rounded-full border-2 transition-transform ${
                        logo.color === c ? 'scale-110 border-foreground' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-sm">
              <PhotoDropzone
                label="Suelta o presiona para cargar tu logo"
                onFiles={async (files) => {
                  const fd = new FormData();
                  fd.append('dest', 'logo');
                  fd.append('photos', files[0]);
                  const res = await fetch('/api/admin/vehicles/photos', { method: 'POST', body: fd });
                  if (!res.ok) {
                    toast.error('No se pudo subir el logo');
                    return;
                  }
                  const data = (await res.json()) as { paths: string[] };
                  setLogo({ ...logo, type: 'image', url: data.paths[0] });
                  toast.success('Logo cargado — guarda para aplicarlo');
                }}
              />
              {logo.url && <p className="mt-2 truncate text-xs text-muted-foreground">{logo.url}</p>}
            </div>
          )}
        </fieldset>

        <div className="lg:col-span-2">
          <Button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar ajustes'}
          </Button>
        </div>
      </form>
    </>
  );
}

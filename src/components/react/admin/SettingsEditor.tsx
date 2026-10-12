// SettingsEditor — pantalla de Ajustes (spec §4.5, primer campo). Edita el
// número de WhatsApp del staff: la cuenta que recibe las confirmaciones de
// reservas (wa.me). Solo español.
import { useState } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Toaster, toast } from '../../ui/sonner';

export default function SettingsEditor({ initialNumber }: { initialNumber: string }) {
  const [number, setNumber] = useState(initialNumber);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappStaffNumber: number.trim() }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.ok) {
        toast.success('Número guardado — las nuevas reservas confirmarán a esta cuenta');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { issues?: Array<{ message: string }> };
      toast.error(data.issues?.[0]?.message ?? 'Revisa el formato del número');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Toaster />
      <form onSubmit={save} className="max-w-md space-y-4 rounded-xl border bg-background p-5">
        <div className="space-y-1.5">
          <Label htmlFor="st-wa">WhatsApp del staff (confirmaciones)</Label>
          <Input
            id="st-wa"
            inputMode="numeric"
            placeholder="5219991234567"
            className="font-mono"
            value={number}
            onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
          />
          <p className="text-xs text-muted-foreground">
            10-15 dígitos con código de país, sin + ni espacios. Es la cuenta que recibe el mensaje
            de confirmación del cliente al reservar.
          </p>
        </div>
        <Button type="submit" disabled={saving || number.trim() === initialNumber}>
          {saving ? 'Guardando…' : 'Guardar'}
        </Button>
      </form>
    </>
  );
}

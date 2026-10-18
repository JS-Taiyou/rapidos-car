// UsersManager — gestión de cuentas del panel (sólo administradores):
// alta con rol (Administrador/Recepción/Patio), cambio de rol, activar o
// desactivar (el historial de auditoría vive: nunca se borran) y
// restablecimiento de contraseña (revoca sesiones). Solo español.
import { useState, useEffect, useCallback } from 'react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Badge } from '../../ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/select';
import { Toaster, toast } from '../../ui/sonner';

type Role = 'admin' | 'desk' | 'yard';

interface UserRow {
  id: number;
  email: string;
  role: Role;
  active: boolean;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  desk: 'Recepción',
  yard: 'Patio',
};

const ROLE_DESC: Record<Role, string> = {
  admin: 'Todo: usuarios, ajustes del negocio y operación.',
  desk: 'Reservaciones, flota, tarifas, clientes y reportes.',
  yard: 'Agenda de entregas y captura de handovers.',
};

export default function UsersManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('desk');
  const [saving, setSaving] = useState(false);
  const [pwdTarget, setPwdTarget] = useState<UserRow | null>(null);
  const [pwdValue, setPwdValue] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.status === 401) {
      window.location.href = '/admin/login';
      return;
    }
    const data = (await res.json()) as { users: UserRow[] };
    setUsers(data.users ?? []);
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password, role }),
      });
      if (res.status === 401) {
        window.location.href = '/admin/login';
        return;
      }
      if (res.status === 201) {
        toast.success(`Cuenta ${email} creada (${ROLE_LABEL[role]})`);
        setEmail('');
        setPassword('');
        await load();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string; issues?: Array<{ message: string }> };
      toast.error(
        data.error === 'duplicate_email'
          ? 'Ya existe una cuenta con ese email'
          : (data.issues?.[0]?.message ?? 'No se pudo crear la cuenta'),
      );
    } finally {
      setSaving(false);
    }
  }

  async function patch(user: UserRow, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users?id=${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      await load();
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { hint?: string; error?: string };
    toast.error(data.hint ?? 'No se pudo actualizar');
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwdTarget) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users?id=${pwdTarget.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwdValue }),
      });
      if (res.ok) {
        toast.success(`Contraseña de ${pwdTarget.email} reestablecida (sus sesiones se revocaron)`);
        setPwdTarget(null);
        setPwdValue('');
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { issues?: Array<{ message: string }> };
      toast.error(data.issues?.[0]?.message ?? 'No se pudo cambiar la contraseña');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Toaster />

      <div className="rounded-xl border" data-tour="usr-tabla">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuenta</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Activa</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id} className={u.active ? '' : 'opacity-60'}>
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => patch(u, { role: v as Role })}>
                    <SelectTrigger className="w-40" aria-label={`Rol de ${u.email}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[#0e7490]"
                    checked={u.active}
                    aria-label={`Cuenta activa ${u.email}`}
                    onChange={(e) => patch(u, { active: e.target.checked })}
                  />
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => { setPwdTarget(u); setPwdValue(''); }}>
                    Contraseña
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pwdTarget && (
        <form onSubmit={savePassword} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-4">
          <div className="flex-1 space-y-1">
            <Label htmlFor="up-pass">Nueva contraseña de {pwdTarget.email}</Label>
            <Input
              id="up-pass"
              type="password"
              minLength={8}
              required
              placeholder="Mínimo 8 caracteres"
              value={pwdValue}
              onChange={(e) => setPwdValue(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={saving}>Guardar</Button>
          <Button type="button" variant="ghost" onClick={() => setPwdTarget(null)}>
            Cancelar
          </Button>
        </form>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed p-4">
        <div className="min-w-52 flex-1 space-y-1">
          <Label htmlFor="nu-email">Nueva cuenta</Label>
          <Input
            id="nu-email"
            type="email"
            required
            placeholder="persona@negocio.mx"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="min-w-44 space-y-1">
          <Label htmlFor="nu-pass">Contraseña inicial</Label>
          <Input
            id="nu-pass"
            type="password"
            minLength={8}
            required
            placeholder="Mínimo 8 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {/* Sin space-y-1: el <select> nativo oculto de Radix es un tercer
            hijo y el margen del espacio le sumaba 4px a la columna (el label
            quedaba más alto que los de al lado). */}
        <div className="w-44">
          <Label htmlFor="nu-role" className="mb-1">
            Rol
          </Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="nu-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <SelectItem key={r} value={r}>
                  {ROLE_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit" disabled={saving}>
          + Crear cuenta
        </Button>
      </form>

      <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        {(Object.keys(ROLE_DESC) as Role[]).map((r) => (
          <p key={r}>
            <Badge variant="secondary">{ROLE_LABEL[r]}</Badge> {ROLE_DESC[r]}
          </p>
        ))}
      </div>
    </div>
  );
}

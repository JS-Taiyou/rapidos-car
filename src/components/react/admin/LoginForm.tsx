// Login del admin (/admin/login, solo español). RHF + zodResolver con el
// MISMO schema del endpoint (§2.12); 401 genérico (nunca distinguir "email
// no existe" de "password incorrecta"); navegación dura a /admin.
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { loginSchema, type LoginInput } from '../../../lib/validation';

export default function LoginForm() {
  const [submitting, setSubmitting] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginInput) {
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { redirect?: string };
        window.location.href = data.redirect ?? '/admin';
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError('root', {
        message:
          data.error === 'too_many_attempts'
            ? 'Demasiados intentos. Espera 10 minutos.'
            : 'Credenciales inválidas',
      });
      setSubmitting(false);
    } catch {
      setError('root', { message: 'No se pudo conectar, intenta de nuevo' });
      setSubmitting(false);
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="username"
          {...register('email')}
        />
        {errors.email && (
          <p role="alert" className="text-xs text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">Contraseña</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          {...register('password')}
        />
        {errors.password && (
          <p role="alert" className="text-xs text-destructive">
            {errors.password.message}
          </p>
        )}
      </div>
      {errors.root && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errors.root.message}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  );
}

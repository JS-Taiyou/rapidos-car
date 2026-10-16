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

const OAUTH_ERRORS: Record<string, string> = {
  oauth_off: 'El acceso con Google no está configurado en este servidor.',
  oauth_state: 'La sesión de Google expiró; vuelve a intentarlo.',
  oauth_code: 'Google no devolvió la autorización; vuelve a intentarlo.',
  oauth_google: 'No se pudo verificar tu cuenta de Google; vuelve a intentarlo.',
  oauth_not_invited: 'Esa cuenta de Google no tiene acceso al panel: pide a un administrador que cree tu cuenta.',
};

export default function LoginForm({ googleEnabled = false }: { googleEnabled?: boolean }) {
  const oauthError = typeof window !== 'undefined'
    ? OAUTH_ERRORS[new URLSearchParams(window.location.search).get('e') ?? '']
    : undefined;
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
      {oauthError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-destructive">
          {oauthError}
        </p>
      )}
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
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            o
            <span className="h-px flex-1 bg-border" />
          </div>
          <a
            href="/api/auth/google"
            className="flex w-full items-center justify-center gap-2 rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.2H12v4.1h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.7 2.9c2.2-2.1 3.7-5.1 3.7-8.6z"/>
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.7-2.9c-1 .7-2.4 1.2-4.2 1.2-3.2 0-5.9-2.1-6.9-5l-3.9 3C3.1 21.3 7.2 24 12 24z"/>
              <path fill="#FBBC05" d="M5.1 14.4c-.2-.7-.4-1.5-.4-2.4s.2-1.7.4-2.4l-3.9-3C.4 8.2 0 10 0 12s.4 3.8 1.2 5.4l3.9-3z"/>
              <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17 1.1 15.2 0 12 0 7.2 0 3.1 2.7 1.2 6.6l3.9 3c1-2.9 3.7-4.9 6.9-4.9z"/>
            </svg>
            Entrar con Google
          </a>
        </>
      )}
    </form>
  );
}

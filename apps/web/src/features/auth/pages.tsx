import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authClient, authErrorMessage, sessionQuery } from '@/lib/auth';
import { IS_DEMO } from '@/lib/demo-flag';
import { AuthCard } from './auth-card';

const origin = () => window.location.origin;

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setPending(false);
    }
  };
  return { pending, error, setError, run };
}

function ErrorAlert({ error }: { error: string | null }) {
  return error ? (
    <Alert variant="destructive">
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  ) : null;
}

export function SignInPage({ redirect }: { redirect?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, run } = useSubmit();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = run(async () => {
    const { error } = await authClient.signIn.email({ email, password });
    if (error) throw new Error(authErrorMessage(error));
    // Fetch the new session now, so the signed-in pages' guard doesn't see a stale "signed out".
    await qc.fetchQuery({ ...sessionQuery, staleTime: 0 });
    await navigate({ to: redirect && redirect.startsWith('/') ? redirect : '/' });
  });

  return (
    <AuthCard
      title="Sign in"
      footer={
        <>
          <Link to="/forgot-password" className="underline">
            Forgotten your password?
          </Link>
          <span>
            New here?{' '}
            <Link to="/sign-up" className="underline">
              Create an account
            </Link>
          </span>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        {IS_DEMO && <p className="text-muted-foreground text-sm">Demo: any email and password will sign you in.</p>}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorAlert error={error} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}

export function SignUpPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { pending, error, run } = useSubmit();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = run(async () => {
    if (password.length < 10) throw new Error('Use at least 10 characters for your password.');
    const { error } = await authClient.signUp.email({ name, email, password, callbackURL: `${origin()}/` });
    if (error) throw new Error(authErrorMessage(error));
    if (IS_DEMO) {
      // No email in the demo: go straight in.
      await qc.fetchQuery({ ...sessionQuery, staleTime: 0 });
      await navigate({ to: '/' });
      return;
    }
    await navigate({ to: '/check-email', search: { email } });
  });

  return (
    <AuthCard
      title="Create an account"
      description="Track your daily trains and get alerts when things change."
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/sign-in" className="underline">
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={submit} className="grid gap-4">
        <Field label="Name" htmlFor="name">
          <Input id="name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorAlert error={error} />
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}

export function CheckEmailPage({ email }: { email?: string }) {
  const [sent, setSent] = useState(false);
  const { pending, error, run } = useSubmit();
  const resend = run(async () => {
    if (!email) return;
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL: `${origin()}/` });
    if (error) throw new Error(authErrorMessage(error));
    setSent(true);
  });
  return (
    <AuthCard title="Check your email" description={<>We've sent a confirmation link{email ? <> to <strong>{email}</strong></> : null}. Open it to finish setting up your account.</>}>
      <form onSubmit={resend} className="grid gap-3">
        <ErrorAlert error={error} />
        {sent && <p className="text-sm">Sent again — it can take a minute to arrive.</p>}
        {email && (
          <Button type="submit" variant="outline" disabled={pending || sent}>
            Resend the link
          </Button>
        )}
        <Link to="/sign-in" className="text-sm underline">
          Back to sign in
        </Link>
      </form>
    </AuthCard>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const { pending, error, run } = useSubmit();
  const submit = run(async () => {
    const { error } = await authClient.requestPasswordReset({ email, redirectTo: `${origin()}/reset-password` });
    if (error) throw new Error(authErrorMessage(error));
    setDone(true);
  });
  return (
    <AuthCard title="Reset your password" description="We'll email you a link to choose a new password.">
      {done ? (
        <p className="text-sm">If an account exists for {email}, a reset link is on its way.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <ErrorAlert error={error} />
          <Button type="submit" disabled={pending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}

export function ResetPasswordPage({ token, error: linkError }: { token?: string; error?: string }) {
  const [password, setPassword] = useState('');
  const { pending, error, run } = useSubmit();
  const navigate = useNavigate();
  const submit = run(async () => {
    if (!token) throw new Error('This reset link is missing its token.');
    if (password.length < 10) throw new Error('Use at least 10 characters for your password.');
    const { error } = await authClient.resetPassword({ newPassword: password, token });
    if (error) throw new Error(authErrorMessage(error));
    await navigate({ to: '/sign-in' });
  });
  if (linkError || !token) {
    return (
      <AuthCard title="Link expired">
        <p className="mb-3 text-sm">This reset link is invalid or has expired.</p>
        <Link to="/forgot-password" className="text-sm underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password">
      <form onSubmit={submit} className="grid gap-4">
        <Field label="New password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <ErrorAlert error={error} />
        <Button type="submit" disabled={pending}>
          Save password
        </Button>
      </form>
    </AuthCard>
  );
}

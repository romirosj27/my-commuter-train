import { schema, type Db } from '@mct/db';
import { resetPasswordMessage, verifyEmailMessage, type EmailTransport } from '@mct/email';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

export interface AuthOptions {
  db: Db;
  email: EmailTransport;
  secret: string;
  /** Public URL of this API (Better Auth builds email links from it). */
  baseURL: string;
  /** Public URL of the web app (redirect targets must be on it). */
  webURL: string;
  trustedOrigins: string[];
  /** Better Auth's own per-endpoint limiter; off in tests. */
  rateLimit?: boolean;
  /**
   * Parent domain for the session cookie when the web app and API are on
   * sibling subdomains (e.g. app.example.com and api.example.com → "example.com").
   */
  cookieDomain?: string;
}

export function createAuth(o: AuthOptions) {
  return betterAuth({
    secret: o.secret,
    baseURL: o.baseURL,
    basePath: '/api/auth',
    trustedOrigins: [o.webURL, ...o.trustedOrigins],
    database: drizzleAdapter(o.db, {
      provider: 'pg',
      schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await o.email.send(resetPasswordMessage(user.email, user.name, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await o.email.send(verifyEmailMessage(user.email, user.name, url));
      },
    },
    user: {
      additionalFields: {
        timezone: { type: 'string', required: false, input: false, defaultValue: 'Europe/London' },
      },
      // Account deletion (GDPR): POST /api/auth/delete-user with the password.
      // Commutes, alert settings, journeys and alert history cascade in the database.
      deleteUser: { enabled: true },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: o.rateLimit ?? true,
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
        '/send-verification-email': { window: 300, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: o.baseURL.startsWith('https://'),
      ...(o.cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: o.cookieDomain } } : {}),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

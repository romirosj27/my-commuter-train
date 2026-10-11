import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, createRoute, createRouter, Link, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { LogOut, TrainFront } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { AccountPage } from '@/features/account/page';
import { CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from '@/features/auth/pages';
import { CommutesPage, EditCommutePage, NewCommutePage } from '@/features/commutes/pages';
import { authClient, sessionQuery } from '@/lib/auth';

interface RouterContext {
  queryClient: QueryClient;
}

function Header() {
  const { data: session } = useQuery(sessionQuery);
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <header className="bg-card border-b">
      <div className="mx-auto flex h-14 max-w-3xl items-center gap-4 px-4">
        <Link to="/" className="flex shrink-0 items-center gap-2 font-semibold whitespace-nowrap">
          <TrainFront className="text-primary size-5" />
          <span className="hidden sm:inline">My Commuter Train</span>
          <span className="sm:hidden">Commuter</span>
        </Link>
        {session && (
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/commutes" activeProps={{ className: 'bg-accent' }}>
                Commutes
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/account" activeProps={{ className: 'bg-accent' }}>
                Account
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={async () => {
                await authClient.signOut();
                qc.clear();
                await navigate({ to: '/sign-in' });
              }}
            >
              <LogOut />
            </Button>
          </nav>
        )}
      </div>
    </header>
  );
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <div className="min-h-dvh">
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  ),
  notFoundComponent: () => (
    <div className="py-12 text-center">
      <p className="mb-4">That page doesn't exist.</p>
      <Link to="/" className="underline">
        Go home
      </Link>
    </div>
  ),
});

// --- Public (signed-out) routes ---
const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'public',
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session) throw redirect({ to: '/' });
  },
});

const signInRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: '/sign-in',
  validateSearch: z.object({ redirect: z.string().optional() }),
  component: function SignIn() {
    const { redirect } = signInRoute.useSearch();
    return <SignInPage redirect={redirect} />;
  },
});
const signUpRoute = createRoute({ getParentRoute: () => publicRoute, path: '/sign-up', component: SignUpPage });
const checkEmailRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: '/check-email',
  validateSearch: z.object({ email: z.string().optional() }),
  component: function CheckEmail() {
    return <CheckEmailPage email={checkEmailRoute.useSearch().email} />;
  },
});
const forgotRoute = createRoute({ getParentRoute: () => publicRoute, path: '/forgot-password', component: ForgotPasswordPage });
const resetRoute = createRoute({
  getParentRoute: () => publicRoute,
  path: '/reset-password',
  validateSearch: z.object({ token: z.string().optional(), error: z.string().optional() }),
  component: function Reset() {
    const s = resetRoute.useSearch();
    return <ResetPasswordPage token={s.token} error={s.error} />;
  },
});

// --- Signed-in routes ---
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (!session) throw redirect({ to: '/sign-in', search: { redirect: location.href } });
    return { session };
  },
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  // The live board becomes the home page in Phase 4.
  beforeLoad: () => {
    throw redirect({ to: '/commutes' });
  },
});
const commutesRoute = createRoute({ getParentRoute: () => appRoute, path: '/commutes', component: CommutesPage });
const newCommuteRoute = createRoute({ getParentRoute: () => appRoute, path: '/commutes/new', component: NewCommutePage });
const editCommuteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/commutes/$commuteId',
  component: function Edit() {
    return <EditCommutePage id={editCommuteRoute.useParams().commuteId} />;
  },
});
const accountRoute = createRoute({ getParentRoute: () => appRoute, path: '/account', component: AccountPage });

const routeTree = rootRoute.addChildren([
  publicRoute.addChildren([signInRoute, signUpRoute, checkEmailRoute, forgotRoute, resetRoute]),
  appRoute.addChildren([indexRoute, commutesRoute, newCommuteRoute, editCommuteRoute, accountRoute]),
]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

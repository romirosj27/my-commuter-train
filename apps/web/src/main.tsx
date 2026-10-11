import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiError } from '@/lib/api';
import { sessionQuery } from '@/lib/auth';
import { createAppRouter } from './router';
import './index.css';

const queryClient: QueryClient = new QueryClient({
  // A 401 from any query means the session has ended: go back to sign in.
  queryCache: new QueryCache({
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        queryClient.setQueryData(sessionQuery.queryKey, null);
        void router.navigate({ to: '/sign-in', search: { redirect: router.state.location.href } });
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
  },
});
const router = createAppRouter(queryClient);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

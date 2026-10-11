/**
 * Demo mode: routes the app's /api requests to the in-browser demo API.
 * Anything else goes to the network as usual.
 */
import { handleDemoRequest } from './api';
import { initDemoClock } from './clock';

export function installDemo(): void {
  initDemoClock();
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(req ? req.url : input.toString(), window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return realFetch(input, init);
    const method = (init?.method ?? req?.method ?? 'GET').toUpperCase();
    let body: unknown = undefined;
    const raw = init?.body ?? (req && method !== 'GET' ? await req.clone().text() : undefined);
    if (typeof raw === 'string' && raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    // A short pause so loading states behave as they would against a server.
    await new Promise((r) => setTimeout(r, 120));
    return (await handleDemoRequest(method, url, body)) ?? realFetch(input, init);
  };
}

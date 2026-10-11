// @vitest-environment jsdom
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { BoardService } from '@mct/shared';
import { BoardTable } from '../src/features/board/board-table';
import { call, service, tv } from './fixtures';

afterEach(cleanup);

async function renderBoard(services: BoardService[]) {
  const root = createRootRoute();
  const index = createRoute({ getParentRoute: () => root, path: '/', component: () => <BoardTable services={services} fromCrs="NCL" toCrs="YRK" /> });
  const svc = createRoute({ getParentRoute: () => root, path: '/services/$serviceId' });
  const router = createRouter({ routeTree: root.addChildren([index, svc]), history: createMemoryHistory({ initialEntries: ['/'] }) });
  render(<RouterProvider router={router} />);
  return screen.findByRole('list', { name: 'Trains' });
}

describe('BoardTable', () => {
  it('lists trains in departure order with links to the detail page', async () => {
    const late = service({ from: call({ departure: tv('2026-11-10T07:40:00Z') }) });
    const early = service({ from: call({ departure: tv('2026-11-10T07:05:00Z') }) });
    const list = await renderBoard([late, early]);
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('07:05');
    expect(items[1]).toHaveTextContent('07:40');
    expect(within(items[0]!).getByRole('link').getAttribute('href')).toBe(`/services/${early.serviceId}?from=NCL&to=YRK`);
  });

  it('highlights a platform change, a delay and its reason', async () => {
    const s = service({
      status: 'delayed',
      delayMin: 12,
      reason: 'Signalling fault',
      from: call({ platform: '4', platformBooked: '2', platformChanged: true, departure: tv('2026-11-10T07:05:00Z', '2026-11-10T07:17:00Z') }),
    });
    const list = await renderBoard([s]);
    expect(within(list).getByLabelText('Platform 4 (changed)')).toBeTruthy();
    expect(list).toHaveTextContent('Exp 07:17');
    expect(list).toHaveTextContent('12 min late');
    expect(list).toHaveTextContent('Signalling fault');
    expect(within(list).getByText('Delayed')).toBeTruthy();
  });

  it('shows cancellations and trains that do not reach the destination', async () => {
    const cancelled = service({ status: 'cancelled', reason: 'Crew shortage', from: call({ isCancelled: true, departure: tv('2026-11-10T08:02:00Z') }) });
    const part = service({ status: 'part_cancelled', to: call({ name: 'York', isCancelled: true, arrival: tv('2026-11-10T09:28:00Z') }), from: call({ departure: tv('2026-11-10T08:30:00Z') }) });
    const list = await renderBoard([cancelled, part]);
    expect(within(list).getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(list).toHaveTextContent('Crew shortage');
    expect(list).toHaveTextContent("Doesn't reach your station");
  });

  it('shows a risk badge only for medium or high risk', async () => {
    const list = await renderBoard([
      service({ risk: { risk: 'high', reasons: ['The train forming this service is 25 min late.'] } }),
      service({ risk: { risk: 'low', reasons: [] }, from: call({ departure: tv('2026-11-10T09:00:00Z') }) }),
    ]);
    expect(within(list).getAllByText(/risk/)).toHaveLength(1);
    expect(within(list).getByText('High risk')).toBeTruthy();
  });
});

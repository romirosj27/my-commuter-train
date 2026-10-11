import type { BoardService } from '@mct/shared';
import { Link } from '@tanstack/react-router';
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from '@tanstack/react-table';
import { AlertTriangle, ArrowRight, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { expectedText, hm, RISK_BADGE, RISK_LABEL, STATUS_BADGE, STATUS_LABEL, statusLine, type ExpectedText } from '@/lib/format';
import { cn } from '@/lib/utils';

const toneClass: Record<ExpectedText['tone'], string> = {
  ok: 'text-success',
  late: 'text-destructive font-semibold',
  early: 'text-success',
  unknown: 'text-muted-foreground',
  cancelled: 'text-destructive font-semibold',
};

function Time({ scheduled, expected }: { scheduled: string | null; expected: ExpectedText }) {
  const struck = expected.tone === 'late' || expected.tone === 'cancelled';
  return (
    <div className="leading-tight">
      <div className={cn('font-mono text-base tabular-nums', struck && 'text-muted-foreground line-through decoration-1')}>{hm(scheduled)}</div>
      <div className={cn('text-xs', toneClass[expected.tone])}>{expected.text}</div>
    </div>
  );
}

export function PlatformBadge({ platform, changed, label = 'Platform' }: { platform: string | null; changed: boolean; label?: string }) {
  if (!platform) return <span className="text-muted-foreground text-sm">—</span>;
  return (
    <span
      className={cn('inline-flex min-w-8 justify-center rounded-md border px-1.5 py-0.5 font-mono text-sm font-semibold', changed && 'border-warning bg-warning/20')}
      aria-label={`${label} ${platform}${changed ? ' (changed)' : ''}`}
      title={changed ? 'Platform changed' : undefined}
    >
      {platform}
      {changed && <span aria-hidden>*</span>}
    </span>
  );
}

function StatusBadges({ s }: { s: BoardService }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge variant={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
      {s.risk && s.risk.risk !== 'low' && (
        <Badge variant={RISK_BADGE[s.risk.risk]} title={s.risk.reasons.join(' ')}>
          <AlertTriangle /> {RISK_LABEL[s.risk.risk]}
        </Badge>
      )}
    </div>
  );
}

const col = createColumnHelper<BoardService>();

const columns = [
  col.accessor((s) => s.from.departure.scheduled ?? '', {
    id: 'departs',
    header: 'Departs',
    cell: ({ row: { original: s } }) => (
      <Time scheduled={s.from.departure.scheduled} expected={expectedText(s.from.departure, s.from.isCancelled)} />
    ),
  }),
  col.accessor((s) => s.from.platform, {
    id: 'platform',
    header: 'Plat.',
    enableSorting: false,
    cell: ({ row: { original: s } }) => <PlatformBadge platform={s.from.platform} changed={s.from.platformChanged} />,
  }),
  col.accessor((s) => s.to.arrival.scheduled ?? '', {
    id: 'arrives',
    header: 'Arrives',
    cell: ({ row: { original: s } }) => <Time scheduled={s.to.arrival.scheduled} expected={expectedText(s.to.arrival, s.to.isCancelled)} />,
  }),
  col.accessor('operator', {
    header: 'Train',
    cell: ({ row: { original: s } }) => (
      <div className="leading-tight">
        <div className="text-sm font-medium">{s.operator}</div>
        <div className="text-muted-foreground text-xs">to {s.destination}</div>
      </div>
    ),
  }),
  col.accessor('status', {
    header: 'Status',
    enableSorting: false,
    cell: ({ row: { original: s } }) => (
      <div className="grid gap-1">
        <StatusBadges s={s} />
        {s.reason && <p className="text-muted-foreground max-w-56 text-xs">{s.reason}</p>}
      </div>
    ),
  }),
];

/**
 * The board: a table on wider screens, a stacked list on phones. Each service
 * links to its detail page.
 */
export function BoardTable({ services, fromCrs, toCrs }: { services: BoardService[]; fromCrs: string; toCrs: string }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'departs', desc: false }]);
  const table = useReactTable({
    data: services,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (s) => s.serviceId,
  });
  const rows = table.getRowModel().rows;
  const detail = (s: BoardService) => ({ to: '/services/$serviceId' as const, params: { serviceId: s.serviceId }, search: { from: fromCrs, to: toCrs } });

  return (
    <>
      {/* Phone: stacked rows */}
      <ul className="bg-card divide-y rounded-xl border sm:hidden" aria-label="Trains">
        {rows.map(({ original: s }) => (
          <li key={s.serviceId}>
            <Link {...detail(s)} className={cn('flex items-center gap-3 px-3 py-3', s.status === 'cancelled' && 'bg-destructive/5')}>
              <div className="grid flex-1 gap-1.5">
                <div className="flex items-center gap-2">
                  <Time scheduled={s.from.departure.scheduled} expected={expectedText(s.from.departure, s.from.isCancelled)} />
                  <ArrowRight className="text-muted-foreground size-3.5" />
                  <Time scheduled={s.to.arrival.scheduled} expected={expectedText(s.to.arrival, s.to.isCancelled)} />
                  <div className="ml-auto">
                    <PlatformBadge platform={s.from.platform} changed={s.from.platformChanged} />
                  </div>
                </div>
                <div className="text-muted-foreground text-xs">
                  {s.operator} to {s.destination} · {statusLine(s)}
                </div>
                <StatusBadges s={s} />
                {s.reason && <p className="text-muted-foreground text-xs">{s.reason}</p>}
              </div>
              <ChevronRight className="text-muted-foreground size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ul>

      {/* Wider screens: table */}
      <div className="bg-card hidden overflow-hidden rounded-xl border sm:block">
        <table className="w-full text-left">
          <thead className="bg-muted/50 text-muted-foreground text-xs uppercase">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="px-3 py-2 font-medium">
                    {h.column.getCanSort() ? (
                      <button type="button" className="uppercase" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: ' ↑', desc: ' ↓' }[h.column.getIsSorted() as string] ?? ''}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
                <th className="sr-only">Details</th>
              </tr>
            ))}
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.id} className={cn('hover:bg-accent/50', row.original.status === 'cancelled' && 'bg-destructive/5')}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-2 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
                <td className="px-2 py-2 text-right align-middle">
                  <Link {...detail(row.original)} aria-label={`Details for the ${hm(row.original.from.departure.scheduled)}`}>
                    <ChevronRight className="text-muted-foreground size-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

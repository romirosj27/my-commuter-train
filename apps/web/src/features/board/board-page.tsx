import { addDays, toLondon, type BoardService, type CommuteDto } from '@mct/shared';
import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CalendarOff, RefreshCw, TrainTrack } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, errorMessage } from '@/lib/api';
import { appNow } from '@/lib/clock';
import { hm } from '@/lib/format';
import { commutesQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { BoardTable, type BoardSort } from './board-table';

export type Direction = 'outbound' | 'return';
export type Day = 'today' | 'tomorrow';

export interface BoardSearch {
  commute?: string;
  dir?: Direction;
  day?: Day;
  sort?: BoardSort;
}

interface BoardResponse {
  commuteId: string;
  direction: Direction;
  date: string;
  window: { start: string; end: string };
  activeDay: boolean;
  generatedAt: string;
  services: BoardService[];
}

/** How often the board refreshes while visible. */
export const BOARD_REFRESH_MS = 30_000;

export const boardQuery = (commuteId: string, dir: Direction, date: string) =>
  queryOptions({
    queryKey: ['board', commuteId, dir, date],
    queryFn: () => api<BoardResponse>(`/api/commutes/${commuteId}/board?direction=${dir}&date=${date}`),
    refetchInterval: BOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });

/** Before noon the outbound board is more useful; after, the return. */
export function defaultDirection(now = appNow()): Direction {
  return toLondon(now).secondsOfDay < 12 * 3600 ? 'outbound' : 'return';
}

function EmptyCommutes() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome! Let's set up your commute</CardTitle>
        <CardDescription>Tell us your stations and when you travel, and your live board will appear here.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/commutes/new">Add your commute</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function BoardPage({ search }: { search: BoardSearch }) {
  const navigate = useNavigate();
  const commutes = useQuery(commutesQuery);
  const list = commutes.data ?? [];
  const commute: CommuteDto | undefined = list.find((c) => c.id === search.commute) ?? list.find((c) => c.isDefault) ?? list[0];
  const dir = search.dir ?? defaultDirection();
  const day = search.day ?? 'today';
  const today = toLondon(appNow()).date;
  const date = day === 'today' ? today : addDays(today, 1);

  const board = useQuery({ ...boardQuery(commute?.id ?? '', dir, date), enabled: !!commute });
  const setSearch = (patch: Partial<BoardSearch>) => navigate({ to: '/', search: (prev: BoardSearch) => ({ ...prev, ...patch }), replace: true });

  if (commutes.isPending) return <BoardSkeleton />;
  if (commutes.error)
    return (
      <Alert variant="destructive">
        <AlertDescription>Couldn't load your commutes: {errorMessage(commutes.error)}</AlertDescription>
      </Alert>
    );
  if (!commute) return <EmptyCommutes />;

  const from = dir === 'outbound' ? commute.homeName : commute.workName;
  const to = dir === 'outbound' ? commute.workName : commute.homeName;
  const fromCrs = dir === 'outbound' ? commute.homeCrs : commute.workCrs;
  const toCrs = dir === 'outbound' ? commute.workCrs : commute.homeCrs;
  const window = dir === 'outbound' ? commute.outbound : commute.return;
  const data = board.data && board.data.commuteId === commute.id ? board.data : undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {list.length > 1 ? (
          <select
            aria-label="Commute"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm font-medium"
            value={commute.id}
            onChange={(e) => setSearch({ commute: e.target.value })}
          >
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <h1 className="text-lg font-semibold">{commute.name}</h1>
        )}
        <div className="ml-auto flex gap-1">
          {(['today', 'tomorrow'] as const).map((d) => (
            <Button key={d} size="sm" variant={day === d ? 'secondary' : 'ghost'} aria-pressed={day === d} onClick={() => setSearch({ day: d })}>
              {d === 'today' ? 'Today' : 'Tomorrow'}
            </Button>
          ))}
        </div>
      </div>

      <Tabs value={dir} onValueChange={(v) => setSearch({ dir: v as Direction })}>
        <TabsList className="w-full">
          <TabsTrigger value="outbound">
            {commute.homeName} → {commute.workName}
          </TabsTrigger>
          <TabsTrigger value="return">
            {commute.workName} → {commute.homeName}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <span>
          {from} to {to}, departing {window.start}–{window.end}
          {commute.operatorCodes.length ? ` · ${commute.operatorCodes.join(', ')} only` : ''}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => board.refetch()}
          disabled={board.isFetching}
          aria-label="Refresh board"
        >
          <RefreshCw className={cn(board.isFetching && 'animate-spin')} />
          {data ? `Updated ${hm(data.generatedAt)}` : 'Refresh'}
        </Button>
      </div>

      {data && !data.activeDay && (
        <Alert>
          <CalendarOff />
          <AlertDescription>You don't usually travel on this day, so you won't get alerts for it. Trains are shown anyway.</AlertDescription>
        </Alert>
      )}

      {board.error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center gap-2">
            Couldn't update the board: {errorMessage(board.error)}
            <Button size="sm" variant="outline" onClick={() => board.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!data && board.isPending && <BoardSkeleton rowsOnly />}

      {data && data.services.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-6 text-center">
            <TrainTrack className="text-muted-foreground size-8" />
            <p className="font-medium">No trains found in your window</p>
            <p className="text-muted-foreground text-sm">
              There are no direct trains from {from} to {to} departing {window.start}–{window.end}
              {commute.operatorCodes.length ? ' with your chosen operators' : ''}.
            </p>
            <Button variant="link" asChild>
              <Link to="/commutes/$commuteId" params={{ commuteId: commute.id }}>
                Change your commute
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {data && data.services.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-sm" role="group" aria-label="Sort trains">
            <span className="text-muted-foreground">Sort:</span>
            {(
              [
                ['departure', 'Departure time'],
                ['delay', 'Most delayed first'],
              ] as const
            ).map(([value, label]) => {
              const on = (search.sort ?? 'departure') === value;
              return (
                <Button key={value} size="sm" variant={on ? 'secondary' : 'ghost'} aria-pressed={on} className="h-7" onClick={() => setSearch({ sort: value === 'departure' ? undefined : value })}>
                  {label}
                </Button>
              );
            })}
          </div>
          <BoardTable services={data.services} fromCrs={fromCrs} toCrs={toCrs} sortBy={search.sort ?? 'departure'} />
        </>
      )}
    </div>
  );
}

function BoardSkeleton({ rowsOnly = false }: { rowsOnly?: boolean }) {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading trains">
      {!rowsOnly && <Skeleton className="h-9" />}
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}

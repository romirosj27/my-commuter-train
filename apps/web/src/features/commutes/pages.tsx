import type { CommuteDto, CommuteInput } from '@mct/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage } from '@/lib/api';
import { commuteQuery, commutesQuery, operatorsQuery } from '@/lib/queries';
import { CommuteForm } from './commute-form';
import { emptyCommuteForm, formFromCommute, WEEKDAYS } from './form-model';

function days(active: number[]): string {
  if (active.length === 5 && active.every((d) => d <= 5)) return 'Weekdays';
  if (active.length === 7) return 'Every day';
  return WEEKDAYS.filter((w) => active.includes(w.day)).map((w) => w.short).join(', ');
}

function CommuteCard({ c }: { c: CommuteDto }) {
  const qc = useQueryClient();
  const { data: operators } = useQuery(operatorsQuery);
  const operatorNames = c.operatorCodes.map((code) => operators?.find((o) => o.code === code)?.name ?? code);
  const makeDefault = useMutation({
    mutationFn: () => api(`/api/commutes/${c.id}/default`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commutesQuery.queryKey }),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/commutes/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commutesQuery.queryKey }),
  });
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {c.name}
          {c.isDefault && <Badge variant="secondary">Default</Badge>}
        </CardTitle>
        <CardDescription>
          {c.homeName} ⇄ {c.workName}
        </CardDescription>
        <CardAction className="flex gap-1">
          <Button variant="ghost" size="icon" asChild aria-label={`Edit ${c.name}`}>
            <Link to="/commutes/$commuteId" params={{ commuteId: c.id }}>
              <Pencil />
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${c.name}`}
            disabled={remove.isPending}
            onClick={() => {
              if (window.confirm(`Delete "${c.name}"?`)) remove.mutate();
            }}
          >
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-muted-foreground grid gap-1 text-sm">
        <p>
          Out {c.outbound.start}–{c.outbound.end} · Back {c.return.start}–{c.return.end} · {days(c.activeDays)}
        </p>
        <p>
          {c.alertSettings.enabled ? `Email alerts on · delays of ${c.alertSettings.delayThresholdMin} min or more` : 'Email alerts off'}
          {operatorNames.length ? ` · ${operatorNames.join(', ')} only` : ''}
        </p>
        {!c.isDefault && (
          <Button variant="link" className="h-auto justify-start p-0" onClick={() => makeDefault.mutate()} disabled={makeDefault.isPending}>
            <Star /> Make default
          </Button>
        )}
        {(remove.error || makeDefault.error) && <p className="text-destructive">{errorMessage(remove.error ?? makeDefault.error)}</p>}
      </CardContent>
    </Card>
  );
}

export function CommutesPage() {
  const { data, isPending, error } = useQuery(commutesQuery);
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your commutes</h1>
        <Button asChild>
          <Link to="/commutes/new">
            <Plus /> Add commute
          </Link>
        </Button>
      </div>
      {isPending && (
        <>
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>Couldn't load your commutes: {errorMessage(error)}</AlertDescription>
        </Alert>
      )}
      {data?.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Set up your first commute</CardTitle>
            <CardDescription>Tell us your stations and when you travel, and we'll watch your trains for you.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link to="/commutes/new">Add commute</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      {data?.map((c) => <CommuteCard key={c.id} c={c} />)}
    </div>
  );
}

export function NewCommutePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Add a commute</h1>
      <CommuteForm
        initial={emptyCommuteForm}
        submitLabel="Save commute"
        onSubmit={async (input) => {
          await api('/api/commutes', { method: 'POST', json: input }).catch((e) => {
            throw new Error(errorMessage(e));
          });
          await qc.invalidateQueries({ queryKey: commutesQuery.queryKey });
          await navigate({ to: '/commutes' });
        }}
      />
    </div>
  );
}

export function EditCommutePage({ id }: { id: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery(commuteQuery(id));
  if (isPending) return <Skeleton className="h-96" />;
  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>{errorMessage(error)}</AlertDescription>
      </Alert>
    );
  const save = async (input: CommuteInput) => {
    const { alertSettings, ...commute } = input;
    try {
      await api(`/api/commutes/${id}`, { method: 'PATCH', json: commute });
      if (alertSettings) await api(`/api/commutes/${id}/alert-settings`, { method: 'PUT', json: alertSettings });
    } catch (e) {
      throw new Error(errorMessage(e));
    }
    await qc.invalidateQueries({ queryKey: commutesQuery.queryKey });
    await navigate({ to: '/commutes' });
  };
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Edit {data.name}</h1>
      <CommuteForm key={data.id} initial={formFromCommute(data)} submitLabel="Save changes" onSubmit={save} />
    </div>
  );
}

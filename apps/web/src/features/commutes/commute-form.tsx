import { alertTypes, type CommuteInput } from '@mct/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeftRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { operatorsQuery } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { ALERT_TYPE_LABELS, toCommuteInput, WEEKDAYS, type CommuteFormValues, type FormErrors } from './form-model';
import { StationPicker } from './station-picker';

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function WindowInputs({
  idPrefix,
  start,
  end,
  onStart,
  onEnd,
}: {
  idPrefix: string;
  start: string;
  end: string;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input id={`${idPrefix}-start`} type="time" aria-label="From" value={start} onChange={(e) => onStart(e.target.value)} className="w-32" />
      <span className="text-muted-foreground text-sm">to</span>
      <Input id={`${idPrefix}-end`} type="time" aria-label="Until" value={end} onChange={(e) => onEnd(e.target.value)} className="w-32" />
    </div>
  );
}

export function CommuteForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: CommuteFormValues;
  submitLabel: string;
  onSubmit: (input: CommuteInput) => Promise<void>;
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<FormErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const operators = useQuery(operatorsQuery);
  const set = <K extends keyof CommuteFormValues>(k: K, value: CommuteFormValues[K]) => setV((prev) => ({ ...prev, [k]: value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const r = toCommuteInput(v);
    if (!r.ok) {
      setErrors(r.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    setSaving(true);
    try {
      await onSubmit(r.input);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save your commute');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Route</CardTitle>
          <CardDescription>Your usual stations and the times you travel. Times are UK time.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field label="Name" htmlFor="name" error={errors.name}>
            <Input id="name" value={v.name} maxLength={60} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
            <Field label="Home station" htmlFor="home" error={errors.home}>
              <StationPicker id="home" value={v.home} onChange={(s) => set('home', s)} invalid={!!errors.home} />
            </Field>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Swap home and work"
              className="justify-self-center"
              onClick={() => setV((p) => ({ ...p, home: p.work, work: p.home }))}
            >
              <ArrowLeftRight />
            </Button>
            <Field label="Work station" htmlFor="work" error={errors.work}>
              <StationPicker id="work" value={v.work} onChange={(s) => set('work', s)} invalid={!!errors.work} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Outbound (home → work)" htmlFor="outbound-start" error={errors.outbound} hint="Trains departing in this window.">
              <WindowInputs
                idPrefix="outbound"
                start={v.outboundStart}
                end={v.outboundEnd}
                onStart={(x) => set('outboundStart', x)}
                onEnd={(x) => set('outboundEnd', x)}
              />
            </Field>
            <Field label="Return (work → home)" htmlFor="return-start" error={errors.return} hint="An end before the start runs past midnight.">
              <WindowInputs
                idPrefix="return"
                start={v.returnStart}
                end={v.returnEnd}
                onStart={(x) => set('returnStart', x)}
                onEnd={(x) => set('returnEnd', x)}
              />
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Days you travel</legend>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map(({ day, short }) => {
                const on = v.activeDays.includes(day);
                return (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={on ? 'default' : 'outline'}
                    aria-pressed={on}
                    onClick={() => set('activeDays', toggle(v.activeDays, day).sort())}
                    className="w-12"
                  >
                    {short}
                  </Button>
                );
              })}
            </div>
            {errors.activeDays && <p className="text-destructive text-sm">{errors.activeDays}</p>}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Operators</legend>
            <p className="text-muted-foreground text-sm">Leave all unticked to see every operator.</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {operators.data?.map((op) => (
                <Label key={op.code} className="font-normal">
                  <Checkbox
                    checked={v.operatorCodes.includes(op.code)}
                    onCheckedChange={() => set('operatorCodes', toggle(v.operatorCodes, op.code))}
                  />
                  {op.name}
                </Label>
              ))}
              {operators.isError && <p className="text-destructive text-sm">Couldn't load operators.</p>}
            </div>
          </fieldset>
          <Label className="font-normal">
            <Checkbox checked={v.isDefault} onCheckedChange={(c) => set('isDefault', c === true)} />
            Make this my default commute
          </Label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email alerts</CardTitle>
          <CardDescription>Alerts are only sent for trains in your windows, on your days, outside quiet hours.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Label className="font-normal">
            <Switch checked={v.alertsEnabled} onCheckedChange={(c) => set('alertsEnabled', c)} />
            Send me email alerts for this commute
          </Label>
          <div className={cn('grid gap-5', !v.alertsEnabled && 'pointer-events-none opacity-50')} aria-disabled={!v.alertsEnabled}>
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Alert me about</legend>
              {alertTypes.map((t) => (
                <Label key={t} className="font-normal">
                  <Checkbox checked={v.alertTypes.includes(t)} onCheckedChange={() => set('alertTypes', toggle(v.alertTypes, t))} />
                  {ALERT_TYPE_LABELS[t]}
                </Label>
              ))}
            </fieldset>
            <Field label="Delay threshold (minutes)" htmlFor="threshold" error={errors.delayThresholdMin}>
              <Input
                id="threshold"
                type="number"
                inputMode="numeric"
                min={1}
                max={240}
                className="w-28"
                value={Number.isNaN(v.delayThresholdMin) ? '' : v.delayThresholdMin}
                onChange={(e) => set('delayThresholdMin', e.target.valueAsNumber)}
              />
            </Field>
            <div className="grid gap-2">
              <Label className="font-normal">
                <Switch checked={v.quietHoursEnabled} onCheckedChange={(c) => set('quietHoursEnabled', c)} />
                Quiet hours
              </Label>
              {v.quietHoursEnabled && (
                <WindowInputs
                  idPrefix="quiet"
                  start={v.quietStart}
                  end={v.quietEnd}
                  onStart={(x) => set('quietStart', x)}
                  onEnd={(x) => set('quietEnd', x)}
                />
              )}
              {errors.quietHours && <p className="text-destructive text-sm">{errors.quietHours}</p>}
            </div>
          </div>
        </CardContent>
      </Card>

      {serverError && (
        <Alert variant="destructive">
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

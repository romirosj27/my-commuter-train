import { useQueryClient } from '@tanstack/react-query';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { appNow } from '@/lib/clock';
import { hm } from '@/lib/format';
import { resetDemoData } from './api';
import { setDemoTime } from './clock';

const PRESETS = [
  { time: '06:45', label: 'Early' },
  { time: '07:50', label: 'Morning rush' },
  { time: '08:20', label: 'Disruption' },
  { time: '17:15', label: 'Evening' },
];

/** Explains demo mode and lets the viewer move the simulated clock. */
export function DemoBanner() {
  const qc = useQueryClient();
  const [now, setNow] = useState(appNow());
  useEffect(() => {
    const t = setInterval(() => setNow(appNow()), 10_000);
    return () => clearInterval(t);
  }, []);
  const jump = async (time: string) => {
    setDemoTime(time);
    setNow(appNow());
    await qc.invalidateQueries();
  };
  return (
    <div className="border-b border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs sm:px-4">
        <span className="inline-flex items-center gap-1 font-semibold">
          <FlaskConical className="size-3.5" /> Demo
        </span>
        <span>
          Mock trains, simulated time <strong className="font-mono">{hm(now.toISOString())}</strong>. Saved in this browser only; no emails are sent.
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {PRESETS.map((p) => (
            <Button key={p.time} size="sm" variant="outline" className="h-6 border-amber-300 bg-transparent px-2 text-xs" onClick={() => jump(p.time)}>
              {p.time} {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs"
            title="Reset the demo data"
            onClick={async () => {
              resetDemoData();
              await jump('07:50');
            }}
          >
            <RotateCcw className="size-3" /> Reset
          </Button>
        </span>
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { stationSearchQuery, type Station } from '@/lib/queries';
import { cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Accessible station combobox: search by name or CRS code. */
export function StationPicker({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: Station | null;
  onChange: (s: Station | null) => void;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value ? `${value.name} (${value.crs})` : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text, 200);
  const { data = [], isFetching } = useQuery({ ...stationSearchQuery(q), enabled: open && q.trim().length >= 2 });
  const listId = useId();

  useEffect(() => {
    setText(value ? `${value.name} (${value.crs})` : '');
  }, [value]);

  const choose = (s: Station) => {
    onChange(s);
    setText(`${s.name} (${s.crs})`);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open && data.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={open && data[active] ? `${listId}-${data[active].crs}` : undefined}
        autoComplete="off"
        placeholder="Station name or code, e.g. York or YRK"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open || !data.length) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, data.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            const s = data[active];
            if (s) choose(s);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {open && q.trim().length >= 2 && (
        <ul
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border p-1 shadow-md"
        >
          {data.length === 0 && (
            <li className="text-muted-foreground px-2 py-1.5 text-sm">{isFetching ? 'Searching…' : 'No stations found'}</li>
          )}
          {data.map((s, i) => (
            <li
              key={s.crs}
              id={`${listId}-${s.crs}`}
              role="option"
              aria-selected={i === active}
              className={cn('flex cursor-pointer justify-between rounded-sm px-2 py-1.5 text-sm', i === active && 'bg-accent')}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{s.name}</span>
              <span className="text-muted-foreground font-mono">{s.crs}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

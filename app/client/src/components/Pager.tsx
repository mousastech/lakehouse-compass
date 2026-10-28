import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '../lib/i18n';

/**
 * Client-side pagination for long lists. Resets to the first page when
 * `resetKey` changes (filter, role, refresh) and clamps when the list shrinks. Pair it
 * with <FillerRows> so every page keeps the same height and the content below
 * never jumps while the user pages through. `resetKey` must be stable across
 * renders (a filter value, a count) — never a freshly filtered array, or the
 * page would reset on every render.
 */
export function usePaged<T>(items: T[], pageSize: number, resetKey: unknown = items.length) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  useEffect(() => setPage(0), [resetKey]);
  const current = Math.min(page, pages - 1);
  const slice = useMemo(() => items.slice(current * pageSize, (current + 1) * pageSize), [items, current, pageSize]);
  return { slice, page: current, pages, setPage, total: items.length, pageSize, filler: items.length > pageSize ? pageSize - slice.length : 0 };
}

/** Invisible rows that pad the last page to the full page height. */
export function FillerRows({ count, cols, rowClass = 'h-10' }: { count: number; cols: number; rowClass?: string }) {
  if (count <= 0) return null;
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <tr key={`filler-${i}`} aria-hidden="true" className={rowClass}>
          <td colSpan={cols} />
        </tr>
      ))}
    </>
  );
}

export function Pager({ page, pages, total, pageSize, setPage, label }: {
  page: number; pages: number; total: number; pageSize: number; setPage: (p: number) => void; label: string;
}) {
  const t = useT();
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const btn = 'grid h-7 w-7 place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav aria-label={label} className="flex items-center justify-end gap-2 px-3 py-2 text-xs text-muted-foreground">
      <span className="tnum" aria-live="polite">
        {from}–{to} {t('pager.of')} {total}
      </span>
      <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page === 0} aria-label={t('pager.prev')}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="tnum">{page + 1} / {pages}</span>
      <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label={t('pager.next')}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}

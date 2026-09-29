import { useMemo } from 'react';
import { Sparkles, FileText, UserX, MoonStar, Copy, Wifi, WifiOff } from 'lucide-react';
import { useLiveRows } from '../lib/analytics';
import { useWorkspace } from '../lib/workspace';
import { toStr, toNum } from '../lib/rows';
import { useT } from '../lib/i18n';
import type { ComponentType } from 'react';

interface Space {
  title: string;
  owner: string;
  hasDescription: boolean;
  msgs: number;
  status: string;
}

// Normalize a title so near-duplicate spaces group together: lowercase, strip a
// trailing timestamp (e.g. "2026-09-08 18:09:26") and collapse whitespace.
function normTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}:\d{2}.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function IssueCard({
  icon: Icon, title, desc, count, unit, items, accent,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string; desc: string; count: number; unit: string; items: string[]; accent: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-card-foreground">{title}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold"
          style={{ color: `var(${accent})`, background: `color-mix(in oklch, var(${accent}) 15%, transparent)` }}>
          {count} <span className="text-[11px] font-normal">{unit}</span>
        </span>
      </div>
      {items.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {items.slice(0, 12).map((it) => (
            <li key={it} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-foreground">{it}</li>
          ))}
          {items.length > 12 && <li className="px-1 py-0.5 text-[11px] text-muted-foreground">+{items.length - 12}</li>}
        </ul>
      )}
    </section>
  );
}

/** Genie Optimize — the easy governance wins across the fleet: spaces with no
 * description, no owner, that sit unused, or that duplicate each other. Compass
 * surfaces them; humans decide. Nothing changes automatically. */
export function GenieOptimize() {
  const t = useT();
  const { ws } = useWorkspace();
  const { rows, loading, source } = useLiveRows('genie_space_inventory', '/api/rows/genie_space_inventory', ws);

  const spaces = useMemo<Space[]>(
    () =>
      rows.map((r) => ({
        title: toStr(r.title) || toStr(r.space_id),
        owner: toStr(r.owner),
        hasDescription: !!r.has_description,
        msgs: toNum(r.msgs_30d),
        status: toStr(r.usage_status) || 'Unused',
      })),
    [rows],
  );

  const issues = useMemo(() => {
    const noDesc = spaces.filter((s) => !s.hasDescription).map((s) => s.title);
    const noOwner = spaces.filter((s) => !s.owner).map((s) => s.title);
    const unused = spaces.filter((s) => s.status === 'Unused').map((s) => s.title);
    const groups = new Map<string, string[]>();
    for (const s of spaces) {
      const k = normTitle(s.title);
      groups.set(k, [...(groups.get(k) || []), s.title]);
    }
    const dupGroups = [...groups.values()].filter((g) => g.length > 1);
    const dupCount = dupGroups.reduce((a, g) => a + g.length, 0);
    const dupSample = dupGroups.map((g) => `${g[0]} ×${g.length}`);
    return { noDesc, noOwner, unused, dupGroups: dupGroups.length, dupCount, dupSample };
  }, [spaces]);

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" style={{ color: 'var(--primary)' }} />
          <h1 className="text-xl font-semibold text-foreground">{t('genieoptimize.title')}</h1>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          style={{ color: source === 'live' ? 'var(--domain-finops)' : 'var(--sev-medium)',
            background: `color-mix(in oklch, var(${source === 'live' ? '--domain-finops' : '--sev-medium'}) 16%, transparent)` }}>
          {source === 'live' ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          {source === 'live' ? t('meta.live') : t('meta.demoMode')}
        </span>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('genieoptimize.subtitle')}</p>

      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : spaces.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">{t('geniespaces.none')}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <IssueCard icon={Copy} accent="--sev-high" count={issues.dupCount} unit={t('genieoptimize.unit.spaces')}
            title={t('genieoptimize.dup.title')} desc={t('genieoptimize.dup.desc')} items={issues.dupSample} />
          <IssueCard icon={FileText} accent="--sev-medium" count={issues.noDesc.length} unit={t('genieoptimize.unit.spaces')}
            title={t('genieoptimize.noDesc.title')} desc={t('genieoptimize.noDesc.desc')} items={issues.noDesc} />
          <IssueCard icon={UserX} accent="--sev-medium" count={issues.noOwner.length} unit={t('genieoptimize.unit.spaces')}
            title={t('genieoptimize.noOwner.title')} desc={t('genieoptimize.noOwner.desc')} items={issues.noOwner} />
          <IssueCard icon={MoonStar} accent="--sev-high" count={issues.unused.length} unit={t('genieoptimize.unit.spaces')}
            title={t('genieoptimize.unused.title')} desc={t('genieoptimize.unused.desc')} items={issues.unused} />
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('genieoptimize.footnote')}</p>
    </div>
  );
}

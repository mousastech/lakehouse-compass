import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, UserPlus, X } from 'lucide-react';
import { useT } from '../lib/i18n';

interface Registered { email: string; added_by: string; added_at: string }
interface Admins {
  managers: string[];
  manager_groups: string[];
  registered: Registered[];
  registry_ready: boolean;
  me: { email: string; is_admin: boolean };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Compass administrators (server-side, shared by every user — unlike the rest of
 * Settings, which lives in this browser). App managers (CAN MANAGE on the app)
 * are admins by default and are managed in Databricks; admins add or remove
 * further admins here.
 */
export function AdminsCard() {
  const t = useT();
  const [data, setData] = useState<Admins | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admins');
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j as Admins);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const call = async (url: string, value: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setEmail('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = () => {
    const v = email.trim().toLowerCase();
    if (!EMAIL.test(v)) {
      setError(t('admins.invalidEmail'));
      return;
    }
    void call('/api/admins', v);
  };

  const canEdit = !!data?.me.is_admin && !!data?.registry_ready;
  const total = (data?.managers.length ?? 0) + (data?.registered.length ?? 0);

  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-busy={!data}>
      <div className="mb-1 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" style={{ color: 'var(--primary)' }} />
        <h2 className="text-sm font-semibold text-card-foreground">{t('admins.title')}</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t('admins.intro')}</p>

      {!data && !error && <div className="h-24 animate-pulse rounded-lg bg-muted/40" />}

      {data && (
        <>
          <ul aria-label={t('admins.title')} className="divide-y divide-border/50 rounded-lg border border-border/60">
            {data.managers.map((m) => (
              <li key={`m:${m}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate text-card-foreground" title={m}>{m}{m === data.me.email && <span className="ml-2 text-[11px] text-muted-foreground">({t('admins.you')})</span>}</span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" title={t('admins.managerHelp')} style={{ color: 'var(--primary)', background: 'color-mix(in oklch, var(--primary) 14%, transparent)' }}>
                  {t('admins.viaApp')}
                </span>
              </li>
            ))}
            {data.manager_groups.map((g) => (
              <li key={`g:${g}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="truncate text-muted-foreground" title={g}>{g}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground" title={t('admins.groupHelp')}>{t('admins.group')}</span>
              </li>
            ))}
            {data.registered.map((r) => {
              const self = r.email === data.me.email;
              const last = total <= 1;
              return (
                <li key={`r:${r.email}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate text-card-foreground" title={r.email}>{r.email}{self && <span className="ml-2 text-[11px] text-muted-foreground">({t('admins.you')})</span>}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {t('admins.addedBy')} {r.added_by} · {r.added_at.slice(0, 10)}
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy || self || last}
                      title={self ? t('admins.notSelf') : last ? t('admins.lastOne') : undefined}
                      onClick={() => void call('/api/admins/remove', r.email)}
                      aria-label={`${t('admins.remove')} ${r.email}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-[var(--sev-high)] disabled:pointer-events-none disabled:opacity-40"
                    >
                      <X className="h-3.5 w-3.5" /> {t('admins.remove')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {canEdit ? (
            <form
              className="mt-3 flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label className="flex-1 text-xs text-muted-foreground" htmlFor="admin-email">
                {t('admins.emailLabel')}
                <input
                  id="admin-email"
                  name="admin-email"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError('');
                  }}
                  placeholder="name@company.com"
                  aria-invalid={!!error}
                  className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
                />
              </label>
              <button
                type="submit"
                disabled={busy || !email.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5" /> {t('admins.add')}
              </button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {!data.registry_ready ? t('admins.notReady') : t('admins.readOnly')}
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">{t('admins.grants')}</p>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-xs" style={{ color: 'var(--sev-high)' }}>{error}</p>}
    </section>
  );
}

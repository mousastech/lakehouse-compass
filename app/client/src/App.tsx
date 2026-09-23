import { useState, useEffect, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider, NavLink, Outlet } from 'react-router';
import {
  LayoutDashboard,
  ShieldCheck,
  DollarSign,
  BrainCircuit,
  Landmark,
  Gauge,
  Users,
  Sparkles,
  Database,
  Activity,
  Compass,
  Megaphone,
  ClipboardCheck,
  CalendarClock,
  ListChecks,
  Telescope,
  History as HistoryIcon,
  GitPullRequestArrow,
  Bot,
  Stethoscope,
  Settings,
  FileText,
  Sun,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { I18nProvider, useT, LanguageSwitcher } from './lib/i18n';
import { getTheme, toggleTheme, type Theme } from './lib/theme';
import { WorkspaceProvider } from './lib/workspace';
import { WorkspaceSelector } from './components/WorkspaceSelector';
import { BrandMark } from './components/Brand';
import { Overview } from './pages/Overview';
import { Findings } from './pages/Findings';
import { FinOps } from './pages/FinOps';
import { Security } from './pages/Security';
import { Reports } from './pages/Reports';
import { Agent } from './pages/Agent';
import { Changes } from './pages/Changes';
import { AIEstate } from './pages/AIEstate';
import { Governance } from './pages/Governance';
import { Genie } from './pages/Genie';
import { GenieReadiness } from './pages/GenieReadiness';
import { Lakebase } from './pages/Lakebase';
import { Performance } from './pages/Performance';
import { Usage } from './pages/Usage';
import { Reliability } from './pages/Reliability';
import { Waf } from './pages/Waf';
import { Digest } from './pages/Digest';
import { History } from './pages/History';
import { SelfCheck } from './pages/SelfCheck';
import { Settings as SettingsPage } from './pages/Settings';
import { Maintenance } from './pages/Maintenance';
import { Compliance } from './pages/Compliance';
import { AgentPanel } from './components/AgentPanel';

interface NavItem {
  to: string;
  tKey: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
  phase?: string;
}
interface NavSection {
  labelKey: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    labelKey: 'nav.section.diagnose',
    items: [
      { to: '/', tKey: 'nav.overview', icon: LayoutDashboard, end: true },
      { to: '/security', tKey: 'nav.security', icon: ShieldCheck },
      { to: '/finops', tKey: 'nav.finops', icon: DollarSign },
      { to: '/ai-estate', tKey: 'nav.ai_estate', icon: BrainCircuit },
      { to: '/governance', tKey: 'nav.governance', icon: Landmark },
      { to: '/performance', tKey: 'nav.performance', icon: Gauge },
      { to: '/usage', tKey: 'nav.usage', icon: Users },
      { to: '/genie', tKey: 'nav.genie', icon: Sparkles },
      { to: '/lakebase', tKey: 'nav.lakebase', icon: Database },
      { to: '/reliability', tKey: 'nav.reliability', icon: Activity },
    ],
  },
  {
    labelKey: 'nav.section.govern',
    items: [
      { to: '/genie-readiness', tKey: 'nav.genie_readiness', icon: Telescope },
      { to: '/waf', tKey: 'nav.waf', icon: Compass },
      { to: '/compliance', tKey: 'nav.compliance', icon: ClipboardCheck },
      { to: '/maintenance', tKey: 'nav.maintenance', icon: CalendarClock },
      { to: '/findings', tKey: 'nav.findings', icon: ListChecks },
      { to: '/history', tKey: 'nav.history', icon: HistoryIcon },
    ],
  },
  {
    labelKey: 'nav.section.act',
    items: [
      { to: '/digest', tKey: 'nav.digest', icon: Megaphone },
      { to: '/reports', tKey: 'nav.reports', icon: FileText },
      { to: '/changes', tKey: 'nav.changes', icon: GitPullRequestArrow },
      { to: '/agent', tKey: 'nav.agent', icon: Bot },
      { to: '/self-check', tKey: 'nav.self_check', icon: Stethoscope, phase: 'Phase 2' },
      { to: '/settings', tKey: 'nav.settings', icon: Settings },
    ],
  },
];

function navClass({ isActive }: { isActive: boolean }) {
  return `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-sidebar-primary text-sidebar-primary-foreground'
      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground'
  }`;
}

function ThemeToggle() {
  const t = useT();
  const [theme, setThemeState] = useState<Theme>(() => getTheme());
  return (
    <button
      type="button"
      onClick={() => setThemeState(toggleTheme())}
      title={t('theme.toggle')}
      aria-label={t('theme.toggle')}
      className="rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

function Layout() {
  const t = useT();
  const [askOpen, setAskOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAskOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setAskOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('compass_sidebar_collapsed') === '1';
    } catch {
      return false;
    }
  });

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem('compass_sidebar_collapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <WorkspaceProvider>
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
      <aside
        className={`shrink-0 bg-sidebar lg:border-r lg:border-sidebar-border ${
          collapsed ? 'lg:w-16' : 'lg:w-64'
        }`}
      >
        <div className={`flex items-center gap-2 border-b border-sidebar-border px-3 py-4 ${collapsed ? 'justify-between lg:flex-col lg:justify-center' : 'justify-between'}`}>
          <BrandMark collapsed={collapsed} />
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
            aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
            className="hidden shrink-0 rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:block"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex flex-col gap-3 overflow-x-auto p-3 lg:overflow-visible">
          {SECTIONS.map((section) => (
            <div key={section.labelKey}>
              {!collapsed && (
                <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
                  {t(section.labelKey)}
                </p>
              )}
              <div className="flex gap-1 lg:flex-col">
                {section.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={navClass}
                    title={t(item.tKey)}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    {!collapsed && <span className="whitespace-nowrap">{t(item.tKey)}</span>}
                    {!collapsed && item.phase && (
                      <span className="ml-auto rounded px-1 text-[9px] uppercase text-sidebar-foreground/40">
                        {item.phase.replace('Phase ', 'P')}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className={`flex items-center gap-2 border-t border-sidebar-border p-3 ${collapsed ? 'justify-between lg:flex-col lg:justify-center' : 'justify-between'}`}>
          <LanguageSwitcher compact={collapsed} />
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/85 px-6 py-3 backdrop-blur">
          <WorkspaceSelector />
          <button
            type="button"
            onClick={() => setAskOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          >
            <Sparkles className="h-4 w-4" style={{ color: 'var(--primary)' }} />
            {t('agent.ask')}
            <kbd className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">⌘K</kbd>
          </button>
        </header>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
        <footer className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
          {t('footer')}
        </footer>
      </div>

      {/* ⌘K → Ask Compass slide-over */}
      <div
        onClick={() => setAskOpen(false)}
        className="fixed inset-0 z-40 bg-black/40 transition-opacity"
        style={{ opacity: askOpen ? 1 : 0, pointerEvents: askOpen ? 'auto' : 'none' }}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md border-l border-border bg-background shadow-2xl"
        style={{ transform: askOpen ? 'translateX(0)' : 'translateX(100%)', transition: 'transform var(--dur-base) var(--ease)' }}
        role="dialog"
        aria-hidden={!askOpen}
      >
        {askOpen && <AgentPanel autoFocus />}
      </aside>
    </div>
    </WorkspaceProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Overview /> },
      { path: '/security', element: <Security /> },
      { path: '/finops', element: <FinOps /> },
      { path: '/ai-estate', element: <AIEstate /> },
      { path: '/governance', element: <Governance /> },
      { path: '/performance', element: <Performance /> },
      { path: '/usage', element: <Usage /> },
      { path: '/genie', element: <Genie /> },
      { path: '/genie-readiness', element: <GenieReadiness /> },
      { path: '/lakebase', element: <Lakebase /> },
      { path: '/reliability', element: <Reliability /> },
      { path: '/waf', element: <Waf /> },
      { path: '/compliance', element: <Compliance /> },
      { path: '/maintenance', element: <Maintenance /> },
      { path: '/findings', element: <Findings /> },
      { path: '/history', element: <History /> },
      { path: '/digest', element: <Digest /> },
      { path: '/reports', element: <Reports /> },
      { path: '/agent', element: <Agent /> },
      { path: '/changes', element: <Changes /> },
      { path: '/self-check', element: <SelfCheck /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
]);

export default function App() {
  return (
    <I18nProvider>
      <RouterProvider router={router} />
    </I18nProvider>
  );
}

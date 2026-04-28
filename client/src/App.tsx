import { useCallback, useEffect, useState } from 'react';
import { Activity, Github } from 'lucide-react';
import { Sidebar, type ViewKey } from './components/layout/Sidebar';
import { ToastViewport } from './components/ui/Toast';
import { TooltipProvider } from './components/ui/Tooltip';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Dashboard } from './pages/Dashboard';
import { Servers } from './pages/Servers';
import { Ports } from './pages/Ports';
import { Custom } from './pages/Custom';
import { Firewall } from './pages/Firewall';
import { Hosts } from './pages/Hosts';
import { Logs } from './pages/Logs';
import { Settings as SettingsPage } from './pages/Settings';
import { api } from './lib/api';
import { useStore } from './lib/store';
import { cn } from './lib/utils';

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard');
  const [visited, setVisited] = useState<Set<ViewKey>>(
    () => new Set<ViewKey>(['dashboard']),
  );

  const setSystemStats = useStore(s => s.setSystemStats);
  const setServers = useStore(s => s.setServers);
  const setCustomServers = useStore(s => s.setCustomServers);
  const appendLog = useStore(s => s.appendLog);
  const setSettings = useStore(s => s.setSettings);

  const navigate = useCallback((next: ViewKey) => {
    setView(next);
    setVisited(prev => (prev.has(next) ? prev : new Set([...prev, next])));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, stats, servers, customs] = await Promise.all([
        api.getSettings(),
        api.getSystemStats(),
        api.listServers(),
        api.listCustom(),
      ]);
      if (cancelled) return;
      if (settings.ok && settings.data) setSettings(settings.data);
      if (stats.ok && stats.data) setSystemStats(stats.data);
      if (servers.ok && servers.data) setServers(servers.data);
      if (customs.ok && customs.data) setCustomServers(customs.data);
    })();

    const offSystem = api.onSystemTick(s => setSystemStats(s));
    const offServers = api.onServersTick(s => setServers(s));
    const offCustom = api.onCustomStatus(list => setCustomServers(list));
    const offLog = api.onCustomLog(line => {
      if (line && typeof (line as any).customId === 'string') {
        appendLog(line);
      }
    });

    return () => {
      cancelled = true;
      offSystem();
      offServers();
      offCustom();
      offLog();
    };
  }, [setSystemStats, setServers, setCustomServers, appendLog, setSettings]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col text-fg">
        <TopBar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar current={view} onChange={navigate} />
          <main className="relative flex-1 overflow-hidden">
            <CachedPage active={view === 'dashboard'} mounted={visited.has('dashboard')}>
              <ErrorBoundary scope="dashboard">
                <Dashboard onJump={navigate} />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'servers'} mounted={visited.has('servers')}>
              <ErrorBoundary scope="servers">
                <Servers />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'ports'} mounted={visited.has('ports')}>
              <ErrorBoundary scope="ports">
                <Ports />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'custom'} mounted={visited.has('custom')}>
              <ErrorBoundary scope="custom">
                <Custom />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'firewall'} mounted={visited.has('firewall')}>
              <ErrorBoundary scope="firewall">
                <Firewall />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'hosts'} mounted={visited.has('hosts')}>
              <ErrorBoundary scope="hosts">
                <Hosts />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'logs'} mounted={visited.has('logs')}>
              <ErrorBoundary scope="logs">
                <Logs />
              </ErrorBoundary>
            </CachedPage>
            <CachedPage active={view === 'settings'} mounted={visited.has('settings')}>
              <ErrorBoundary scope="settings">
                <SettingsPage />
              </ErrorBoundary>
            </CachedPage>
          </main>
        </div>
        <ToastViewport />
      </div>
    </TooltipProvider>
  );
}

function TopBar() {
  return (
    <header className="flex h-10 items-center justify-between border-b border-border bg-bg-base/80 px-4 backdrop-blur">
      <div className="flex items-center gap-2 text-sm">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent/15 text-accent">
          <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
        </div>
        <span className="font-semibold tracking-tight">LLSGC</span>
        <span className="text-fg-subtle">·</span>
        <span className="text-fg-muted text-xs">Live Local Servers — web</span>
      </div>
      <div className="flex items-center gap-2">
        <a
          href="https://github.com/Taha-Mahmoodi/LLSGC-server"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev/60 px-2 py-1 text-[11px] text-fg-muted transition hover:border-border-strong hover:text-fg"
        >
          <Github className="h-3 w-3" />
          GitHub
        </a>
      </div>
    </header>
  );
}

function CachedPage({
  active,
  mounted,
  children,
}: {
  active: boolean;
  mounted: boolean;
  children: React.ReactNode;
}) {
  if (!mounted) return null;
  return (
    <div
      className={cn('absolute inset-0', active ? 'block' : 'hidden')}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

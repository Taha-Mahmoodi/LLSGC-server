import type {
  AppSettings,
  CommonPort,
  CustomServer,
  CustomServerInput,
  DetectedServer,
  FirewallRule,
  HostEntryInput,
  HostsInfo,
  IpcResult,
  LogLine,
  PortCheckResult,
  ProcessDetails,
  SystemStats,
} from '@shared/types';
import { IPC, type IpcChannel } from '@shared/channels';
import { useStore } from './store';

const API_BASE = '/api/call';
const WS_PATH = '/ws';
const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 15000;

let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_MIN;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Map<string, Set<(payload: any) => void>>();

function ensureSocket(): void {
  if (typeof window === 'undefined') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${window.location.host}${WS_PATH}`;
  try {
    ws = new WebSocket(url);
  } catch (err) {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    reconnectDelay = RECONNECT_MIN;
  };
  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      const set = subscribers.get(msg.event);
      if (set) {
        for (const fn of set) {
          try {
            fn(msg.data);
          } catch (err) {
            console.error('[ws subscriber]', err);
          }
        }
      }
    } catch (err) {
      console.error('[ws parse]', err);
    }
  };
  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX);
    ensureSocket();
  }, reconnectDelay);
}

function listen<T>(channel: IpcChannel, handler: (payload: T) => void): () => void {
  ensureSocket();
  const set = subscribers.get(channel) ?? new Set();
  set.add(handler as (payload: any) => void);
  subscribers.set(channel, set);
  return () => {
    const cur = subscribers.get(channel);
    if (!cur) return;
    cur.delete(handler as (payload: any) => void);
    if (cur.size === 0) subscribers.delete(channel);
  };
}

async function invoke<T>(channel: IpcChannel, ...args: unknown[]): Promise<IpcResult<T>> {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${res.statusText}` };
    }
    return (await res.json()) as IpcResult<T>;
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

async function copyToClipboard(text: string): Promise<IpcResult> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok ? { ok: true } : { ok: false, error: 'Copy command failed' };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

function openInNewTab(url: string): IpcResult {
  const w = window.open(url, '_blank', 'noopener,noreferrer');
  return w ? { ok: true } : { ok: false, error: 'Popup blocked' };
}

export interface BrowserApi {
  getSystemStats(): Promise<IpcResult<SystemStats>>;
  onSystemTick(h: (s: SystemStats) => void): () => void;

  listServers(): Promise<IpcResult<DetectedServer[]>>;
  onServersTick(h: (s: DetectedServer[]) => void): () => void;
  killServer(pid: number, force?: boolean): Promise<IpcResult>;
  openServer(url: string): Promise<IpcResult>;
  copyText(text: string): Promise<IpcResult>;
  serverDetails(pid: number): Promise<IpcResult<ProcessDetails>>;
  revealLocation(p: string): Promise<IpcResult>;

  listCustom(): Promise<IpcResult<CustomServer[]>>;
  saveCustom(input: CustomServerInput): Promise<IpcResult<CustomServer>>;
  removeCustom(id: string): Promise<IpcResult>;
  startCustom(id: string): Promise<IpcResult<{ pid?: number }>>;
  stopCustom(id: string): Promise<IpcResult>;
  restartCustom(id: string): Promise<IpcResult>;
  getLogs(id: string): Promise<IpcResult<LogLine[]>>;
  clearLogs(id: string): Promise<IpcResult>;
  onCustomLog(h: (line: LogLine) => void): () => void;
  onCustomStatus(h: (list: CustomServer[]) => void): () => void;

  listFirewall(): Promise<IpcResult<FirewallRule[]>>;
  blockPort(input: any): Promise<IpcResult<{ ruleNames: string[] }>>;
  unblockRule(name: string): Promise<IpcResult>;
  toggleRule(name: string, enabled: boolean): Promise<IpcResult>;

  getSettings(): Promise<IpcResult<AppSettings>>;
  updateSettings(patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>>;

  listHosts(): Promise<IpcResult<HostsInfo>>;
  saveHost(input: HostEntryInput): Promise<IpcResult<any>>;
  removeHost(id: string): Promise<IpcResult>;
  toggleHost(id: string, enabled: boolean): Promise<IpcResult>;

  checkPort(port: number): Promise<IpcResult<PortCheckResult>>;
  checkPorts(ports: number[]): Promise<IpcResult<PortCheckResult[]>>;
  listCommonPorts(): Promise<IpcResult<CommonPort[]>>;

  quit(): Promise<void>;
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  platform(): Promise<IpcResult<{ platform: string; isWindows: boolean }>>;
  openExternal(url: string): Promise<IpcResult>;
  pickDirectory(): Promise<IpcResult<string | null>>;
}

export const api: BrowserApi = {
  getSystemStats: () => invoke(IPC.systemStats),
  onSystemTick: h => listen(IPC.systemTick, h),

  listServers: () => invoke(IPC.serversList),
  onServersTick: h => listen(IPC.serversTick, h),
  killServer: (pid, force = false) => invoke(IPC.serversKill, pid, force),
  openServer: async url => openInNewTab(url),
  copyText: copyToClipboard,
  serverDetails: pid => invoke(IPC.serversDetails, pid),
  revealLocation: p => invoke(IPC.serversRevealLocation, p),

  listCustom: () => invoke(IPC.customList),
  saveCustom: input => invoke(IPC.customSave, input),
  removeCustom: id => invoke(IPC.customRemove, id),
  startCustom: id => invoke(IPC.customStart, id),
  stopCustom: id => invoke(IPC.customStop, id),
  restartCustom: id => invoke(IPC.customRestart, id),
  getLogs: id => invoke(IPC.customLogs, id),
  clearLogs: id => invoke(IPC.customLogsClear, id),
  onCustomLog: h => listen(IPC.customLogTick, h),
  onCustomStatus: h => listen(IPC.customStatusTick, h),

  listFirewall: () => invoke(IPC.firewallList),
  blockPort: input => invoke(IPC.firewallBlock, input),
  unblockRule: name => invoke(IPC.firewallUnblock, name),
  toggleRule: (name, enabled) => invoke(IPC.firewallToggle, name, enabled),

  getSettings: () => invoke(IPC.settingsGet),
  updateSettings: patch => invoke(IPC.settingsUpdate, patch),

  listHosts: () => invoke(IPC.hostsList),
  saveHost: input => invoke(IPC.hostsSave, input),
  removeHost: id => invoke(IPC.hostsRemove, id),
  toggleHost: (id, enabled) => invoke(IPC.hostsToggle, id, enabled),

  checkPort: port => invoke(IPC.portsCheck, port),
  checkPorts: ports => invoke(IPC.portsCheckMany, ports),
  listCommonPorts: () => invoke(IPC.portsCommon),

  quit: async () => undefined,
  minimize: async () => undefined,
  maximize: async () => undefined,
  platform: () => invoke(IPC.appPlatform),
  openExternal: async url => openInNewTab(url),
  pickDirectory: () => invoke(IPC.appPickDirectory),
};

export async function call<T>(
  promise: Promise<IpcResult<T>>,
  errorTitle = 'Operation failed',
): Promise<T | null> {
  try {
    const r = await promise;
    if (r.ok) return r.data ?? (undefined as unknown as T);
    useStore.getState().pushToast({
      title: errorTitle,
      description: r.error,
      tone: 'err',
    });
    return null;
  } catch (err: any) {
    useStore.getState().pushToast({
      title: errorTitle,
      description: err?.message ?? String(err),
      tone: 'err',
    });
    return null;
  }
}

export async function callOk<T>(
  promise: Promise<IpcResult<T>>,
  successTitle?: string,
  errorTitle = 'Operation failed',
): Promise<T | null> {
  const result = await call(promise, errorTitle);
  if (result !== null && successTitle) {
    useStore.getState().pushToast({ title: successTitle, tone: 'ok' });
  }
  return result;
}

export function isElectronWindow() {
  return false;
}

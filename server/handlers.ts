import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { IPC } from '../shared/channels.js';
import {
  AppSettings,
  CustomServer,
  CustomServerInput,
  DetectedServer,
  HostEntryInput,
  HostsInfo,
  IpcResult,
  PortCheckResult,
  SystemStats,
} from '../shared/types.js';
import { scanListeningPorts } from './services/port-scanner.js';
import { getDetails, getProcessInfoBatch, pruneDeadPids } from './services/process-info.js';
import { killPid } from './services/process-killer.js';
import {
  blockPort,
  listFirewallRules,
  setRuleEnabled,
  unblockByRuleName,
} from './services/firewall.js';
import { getSystemStats } from './services/system-stats.js';
import { customManager } from './services/custom-manager.js';
import { store } from './services/store.js';
import {
  readHosts,
  saveHostEntry,
  removeHostEntry,
  toggleHostEntry,
} from './services/hosts.js';
import {
  checkPort,
  checkPorts,
  listCommonPorts,
} from './services/port-check.js';
import { reachableUrls } from './services/network-info.js';
import { probe } from './services/http-probe.js';
import { runDiagnostics } from './services/diagnostics.js';

const execAsync = promisify(exec);

type Handler = (...args: any[]) => Promise<IpcResult<any>> | IpcResult<any>;

function ok<T>(data?: T): IpcResult<T> {
  return { ok: true, data };
}

function fail<T = void>(err: unknown): IpcResult<T> {
  const message = err instanceof Error ? err.message : String(err);
  return { ok: false, error: message.slice(0, 500) };
}

export const handlers: Record<string, Handler> = {
  [IPC.systemStats]: async (): Promise<IpcResult<SystemStats>> => ok(getSystemStats()),

  [IPC.serversList]: async (): Promise<IpcResult<DetectedServer[]>> => {
    try {
      return ok(await collectServers());
    } catch (err) {
      return fail(err);
    }
  },

  [IPC.serversKill]: async (pid: number, force = false): Promise<IpcResult> => {
    const r = await killPid(pid, force);
    return r.ok ? ok() : fail(r.error || 'Kill failed');
  },

  [IPC.serversOpen]: async (url: string): Promise<IpcResult> => {
    try {
      const opener = await import('open');
      await opener.default(url);
      return ok();
    } catch (err) {
      return fail(err);
    }
  },

  [IPC.serversCopy]: async (_text: string): Promise<IpcResult> => {
    return { ok: false, error: 'Copy is handled client-side in the browser version.' };
  },

  [IPC.serversDetails]: async (pid: number): Promise<IpcResult<any>> => {
    const info = await getDetails(pid);
    if (!info) return fail('Process not found');
    return ok(info);
  },

  [IPC.serversRevealLocation]: async (executable: string): Promise<IpcResult> => {
    if (!executable) return fail('No executable path');
    if (process.platform !== 'win32') {
      return fail('Reveal-in-folder is only supported on Windows servers.');
    }
    try {
      await execAsync(`explorer.exe /select,"${executable.replace(/"/g, '')}"`, { windowsHide: true });
      return ok();
    } catch (err) {
      return fail(err);
    }
  },

  [IPC.customList]: async (): Promise<IpcResult<CustomServer[]>> => ok(customManager.list()),

  [IPC.customSave]: async (input: CustomServerInput): Promise<IpcResult<CustomServer>> => {
    if (!input?.name?.trim()) return fail('Name is required');
    if (!input?.command?.trim()) return fail('Command is required');
    return ok(
      customManager.save({
        id: input.id,
        name: input.name,
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        env: input.env,
        port: input.port,
        url: input.url,
        color: input.color,
        autoStart: input.autoStart,
      }),
    );
  },

  [IPC.customRemove]: async (id: string): Promise<IpcResult> => {
    return customManager.remove(id) ? ok() : fail('Not found');
  },

  [IPC.customStart]: async (id: string): Promise<IpcResult<{ pid?: number }>> => {
    const r = await customManager.start(id);
    return r.ok ? ok({ pid: r.pid }) : fail(r.error || 'Start failed');
  },

  [IPC.customStop]: async (id: string): Promise<IpcResult> => {
    const r = await customManager.stop(id);
    return r.ok ? ok() : fail(r.error || 'Stop failed');
  },

  [IPC.customRestart]: async (id: string): Promise<IpcResult> => {
    const r = await customManager.restart(id);
    return r.ok ? ok() : fail(r.error || 'Restart failed');
  },

  [IPC.customLogs]: async (id: string): Promise<IpcResult<any>> => ok(customManager.getLogs(id)),

  [IPC.customLogsClear]: async (id: string): Promise<IpcResult> => {
    customManager.clearLogs(id);
    return ok();
  },

  [IPC.firewallList]: async (): Promise<IpcResult<any>> => ok(await listFirewallRules()),

  [IPC.firewallBlock]: async (input: any): Promise<IpcResult<any>> => {
    const r = await blockPort(input);
    return r.ok ? ok({ ruleNames: r.ruleNames }) : fail(r.error || 'Block failed');
  },

  [IPC.firewallUnblock]: async (name: string): Promise<IpcResult> => {
    const r = await unblockByRuleName(name);
    return r.ok ? ok() : fail(r.error || 'Unblock failed');
  },

  [IPC.firewallToggle]: async (name: string, enabled: boolean): Promise<IpcResult> => {
    const r = await setRuleEnabled(name, enabled);
    return r.ok ? ok() : fail(r.error || 'Toggle failed');
  },

  [IPC.settingsGet]: async (): Promise<IpcResult<AppSettings>> => ok(store.getSettings()),

  [IPC.settingsUpdate]: async (patch: Partial<AppSettings>): Promise<IpcResult<AppSettings>> => {
    return ok(store.updateSettings(patch));
  },

  [IPC.hostsList]: async (): Promise<IpcResult<HostsInfo>> => {
    try {
      return ok(await readHosts());
    } catch (err) {
      return fail(err);
    }
  },

  [IPC.hostsSave]: async (input: HostEntryInput): Promise<IpcResult<any>> => {
    const r = await saveHostEntry(input);
    return r.ok ? ok({ entry: r.entry }) : fail(r.error || 'Save failed');
  },

  [IPC.hostsRemove]: async (id: string): Promise<IpcResult> => {
    const r = await removeHostEntry(id);
    return r.ok ? ok() : fail(r.error || 'Remove failed');
  },

  [IPC.hostsToggle]: async (id: string, enabled: boolean): Promise<IpcResult> => {
    const r = await toggleHostEntry(id, enabled);
    return r.ok ? ok() : fail(r.error || 'Toggle failed');
  },

  [IPC.portsCheck]: async (port: number): Promise<IpcResult<PortCheckResult>> => {
    return ok(await checkPort(port));
  },

  [IPC.portsCheckMany]: async (ports: number[]): Promise<IpcResult<PortCheckResult[]>> => {
    if (!Array.isArray(ports)) return fail('ports must be an array');
    return ok(await checkPorts(ports));
  },

  [IPC.portsCommon]: async (): Promise<IpcResult<any>> => ok(listCommonPorts()),

  [IPC.serversProbe]: async (
    url: string,
    opts?: { timeoutMs?: number; method?: 'GET' | 'HEAD' },
  ): Promise<IpcResult<any>> => {
    if (!url || typeof url !== 'string') return fail('url is required');
    return ok(await probe(url, opts));
  },

  [IPC.diagnosticsRun]: async (): Promise<IpcResult<any>> => {
    return ok(await runDiagnostics());
  },

  [IPC.updateCheck]: async (): Promise<IpcResult<any>> => {
    return ok({ kind: 'idle' });
  },

  [IPC.updateApply]: async (): Promise<IpcResult> => {
    return fail('Auto-update is desktop-only.');
  },

  [IPC.appPlatform]: async (): Promise<IpcResult<{ platform: string; isWindows: boolean }>> => {
    return ok({ platform: process.platform, isWindows: process.platform === 'win32' });
  },

  [IPC.appOpenExternal]: async (url: string): Promise<IpcResult> => {
    try {
      const opener = await import('open');
      await opener.default(url);
      return ok();
    } catch (err) {
      return fail(err);
    }
  },

  [IPC.appPickDirectory]: async (): Promise<IpcResult<string | null>> => {
    return { ok: false, error: 'Directory picker is unavailable in the web version. Type the path manually.' };
  },

  [IPC.appQuit]: async (): Promise<IpcResult> => ok(),
  [IPC.appMinimize]: async (): Promise<IpcResult> => ok(),
  [IPC.appMaximize]: async (): Promise<IpcResult> => ok(),
};

async function collectServers(): Promise<DetectedServer[]> {
  const ports = await scanListeningPorts();
  const pids = [...new Set(ports.map(p => p.pid))].filter(p => p > 0);
  const proc = await getProcessInfoBatch(pids);
  pruneDeadPids(new Set(pids));

  const customs = customManager.list();
  const customByPid = new Map<number, CustomServer>();
  for (const c of customs) if (c.pid) customByPid.set(c.pid, c);
  const settings = store.getSettings();

  const out: DetectedServer[] = [];
  for (const port of ports) {
    const info = proc.get(port.pid);
    const custom = customByPid.get(port.pid);
    if (!settings.showSystemPorts && !custom) {
      if (looksLikeSystemProcess(info?.name)) continue;
    }
    const startedAt = info?.startedAt ?? Date.now();
    const urls = reachableUrls(port.address, port.port, port.protocol);
    out.push({
      pid: port.pid,
      name: info?.name ?? `pid:${port.pid}`,
      command: info?.command,
      port: port.port,
      protocol: port.protocol,
      address: port.address,
      state: port.state,
      cpu: info?.cpu ?? 0,
      memoryBytes: info?.memoryBytes ?? 0,
      uptimeSec: Math.max(0, (Date.now() - startedAt) / 1000),
      startedAt,
      url: urls[0] ?? buildUrl(port.address, port.port, port.protocol),
      urls: urls.length > 0 ? urls : undefined,
      customId: custom?.id,
    });
  }
  out.sort((a, b) => {
    if (a.customId && !b.customId) return -1;
    if (!a.customId && b.customId) return 1;
    return a.port - b.port;
  });
  return out;
}

export async function buildTickPayload(): Promise<{ stats: SystemStats; servers: DetectedServer[] }> {
  return { stats: getSystemStats(), servers: await collectServers() };
}

function buildUrl(address: string, port: number, protocol: string): string | undefined {
  if (protocol !== 'tcp') return undefined;
  const host = address === '0.0.0.0' || address === '::' || address === '*' ? 'localhost' : address;
  return `http://${host}:${port}`;
}

const SYSTEM_NAMES = new Set([
  'svchost.exe', 'system', 'services.exe', 'lsass.exe', 'wininit.exe',
  'spoolsv.exe', 'winlogon.exe', 'csrss.exe', 'smss.exe', 'searchhost.exe',
  'searchindexer.exe', 'searchapp.exe', 'systemsettings.exe', 'fontdrvhost.exe',
  'dwm.exe', 'audiodg.exe', 'unsecapp.exe', 'wudfhost.exe',
]);

function looksLikeSystemProcess(name?: string): boolean {
  if (!name) return false;
  return SYSTEM_NAMES.has(name.toLowerCase());
}

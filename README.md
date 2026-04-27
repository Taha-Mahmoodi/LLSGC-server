# LLSGC-server — Live Local Servers (web edition)

[![CI](https://github.com/Taha-Mahmoodi/LLSGC-server/actions/workflows/ci.yml/badge.svg)](https://github.com/Taha-Mahmoodi/LLSGC-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Same control panel as [LLSGC](https://github.com/Taha-Mahmoodi/LLSGC), but it runs as a **local Node.js agent** and serves the UI to any browser. No Chromium bundled — install drops from ~64 MB to under 10 MB, and you can control your machine from another laptop or phone on the LAN.

```
┌─────────────────────┐         HTTP + WS         ┌──────────────────────┐
│  Your browser       │  ◄──────────────────────► │  llsgc-server        │
│  http://localhost:  │      /api/call (POST)     │  (Node + Express)    │
│  47291              │      /ws (WebSocket)      │                      │
└─────────────────────┘                           │  netstat / tasklist  │
                                                  │  taskkill / netsh    │
                                                  │  spawn launchers     │
                                                  └──────────────────────┘
```

## Features

Same as the desktop edition:

- **Server discovery** — every TCP/UDP port your machine is listening on, with PID, name, command-line.
- **Resource monitor** — per-process CPU%, memory, uptime in real time.
- **One-click control** — stop, open in browser, copy URL, reveal executable.
- **Launchers** — saved server commands with auto-start, environment variables, and a tailing log viewer.
- **Firewall (Windows)** — block/unblock ports and toggle rules.
- **Settings** — theme, refresh rate, system-process visibility.

What's different in the web edition:
- Window controls (minimize, maximize, quit) are gone — your browser handles those.
- "Open in browser" opens a new tab instead of launching an external browser.
- "Reveal in folder" only works when the agent runs on Windows and you're connecting locally.
- Configuration lives in `~/.config/llsgc/` (Linux/macOS) or `%APPDATA%/LLSGC/` (Windows).

## Quick start

Requires Node 20+.

```bash
# Clone, install, run
git clone https://github.com/Taha-Mahmoodi/LLSGC-server.git
cd LLSGC-server
npm install
npm run build
npm start

# Or in development mode (Vite + tsx watch)
npm run dev
```

The agent listens on `127.0.0.1:47291` by default and opens your browser automatically.

## CLI flags

```bash
llsgc-server [options]

  -p, --port <port>      Port to listen on (default: 47291, env: LLSGC_PORT)
  -H, --host <host>      Host to bind to (default: 127.0.0.1, env: LLSGC_HOST)
      --no-open          Do not open the browser on start
      --no-auto-start    Skip auto-starting saved launchers
  -v, --version          Print version
  -h, --help             Show help
```

Bind to all interfaces and control the box from another device on your LAN:

```bash
llsgc-server --host 0.0.0.0 --port 47291
# then from your laptop: http://<server-ip>:47291
```

> **Security note:** the agent has root-level powers — it can kill any of your processes and modify firewall rules. Only bind to `0.0.0.0` on a trusted network. There is currently no built-in auth; put it behind SSH tunneling or a reverse proxy with auth if you expose it.

## Project structure

```
server/
├── index.ts             CLI bootstrap, signal handling, browser open
├── http.ts              Express + static client + /api/call dispatcher
├── ws.ts                WebSocket: tick broadcasts and launcher events
├── handlers.ts          Channel → handler map (same channel names as desktop)
└── services/            Reused from LLSGC, store adapted to ~/.config/llsgc/
    ├── port-scanner.ts
    ├── process-info.ts
    ├── process-killer.ts
    ├── firewall.ts
    ├── custom-manager.ts
    ├── system-stats.ts
    └── store.ts

shared/
├── types.ts             Cross-cutting types
└── channels.ts          Channel name constants (used as REST/WS event names)

client/
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx          No frameless titlebar — runs in a browser
    ├── lib/api.ts       fetch + WebSocket transport (replaces window.llsgc IPC)
    ├── components/
    └── pages/
```

## Architecture

The desktop edition uses Electron's `ipcMain.handle` / `webContents.send` to bridge the renderer and the main process. The web edition replaces both:

- **Request/response** — `POST /api/call` with `{ channel, args }`. The server looks up the handler and returns `{ ok, data, error }`.
- **Streaming events** — a single `/ws` WebSocket. The server broadcasts `{ event, data }` for `system:tick`, `servers:tick`, `custom:status:tick`, and `custom:log:tick`.

The channel-name constants are shared with the desktop repo, so the same React UI works in both modes with only the transport swapped out.

## Build a single binary

Coming soon — Node SEA (single executable applications) lets us ship a self-contained `.exe` for users without Node installed. Until then, `npm install` is required.

## Roadmap

- Single-binary `.exe` distribution (Node SEA).
- Optional bearer-token auth for `0.0.0.0` deployments.
- Multi-machine mode: one UI controlling several agents.
- Auto-update from GitHub Releases.

## License

MIT — see [LICENSE](./LICENSE).

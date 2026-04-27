import express from 'express';
import { createServer, Server as HttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { handlers } from './handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startHttpServer(port: number, host: string): HttpServer {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use((req, _res, next) => {
    if (host === '127.0.0.1' || host === 'localhost') return next();
    next();
  });

  app.post('/api/call', async (req, res) => {
    const { channel, args = [] } = req.body ?? {};
    if (!channel || typeof channel !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing channel' });
      return;
    }
    const handler = handlers[channel];
    if (!handler) {
      res.status(404).json({ ok: false, error: `Unknown channel: ${channel}` });
      return;
    }
    try {
      const result = await handler(...(Array.isArray(args) ? args : []));
      res.json(result ?? { ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message ?? String(err) });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, version: process.env.LLSGC_VERSION ?? 'dev' });
  });

  const clientDir = resolveClientDir();
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    app.get('*', (_req, res) => {
      res
        .status(404)
        .send('Client bundle not built. Run `npm run build` or `npm run dev`.');
    });
  }

  const server = createServer(app);
  server.listen(port, host);
  return server;
}

function resolveClientDir(): string | null {
  const candidates = [
    path.join(__dirname, '../client'),
    path.join(__dirname, '../../dist/client'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from './db/db.js';
import { registerRoutes } from './routes/routes.js';
import { AppError } from './security/errors.js';
import { scheduleTvMaintenance } from './services/tvjob.js';
import { backfillPlayPlatforms } from './services/games.js';

const VERSION = '0.1.0';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface ServerOptions {
  db: DB;
  host: string;
  port: number;
  dataDir: string;
  /** Extra origins allowed to call mutating routes (the Vite dev server in development). */
  extraOrigins?: string[];
  serveStatic?: boolean;
}

export function buildServer(o: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'warn' },
    bodyLimit: 1_000_000,
    genReqId: () => crypto.randomUUID(),
  });

  const hostnames = new Set([`127.0.0.1:${o.port}`, `localhost:${o.port}`, ...(o.extraOrigins ?? []).map((u) => new URL(u).host)]);
  const origins = new Set([`http://127.0.0.1:${o.port}`, `http://localhost:${o.port}`, ...(o.extraOrigins ?? [])]);

  // Loopback hardening: Host allowlist defeats DNS rebinding; Origin + custom header defeat CSRF from hostile sites.
  app.addHook('onRequest', async (req, reply) => {
    if (!hostnames.has(req.headers.host ?? '')) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Host not allowed', requestId: req.id } });
    }
    if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (!origin || !origins.has(origin) || req.headers['x-blackhole'] !== '1') {
        return reply.code(403).send({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Cross-origin request blocked', requestId: req.id } });
      }
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https://static.tvmaze.com https://covers.openlibrary.org https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, requestId: req.id } });
    }
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: { code: 'VALIDATION_ERROR', message: e.message ?? 'Bad request', requestId: req.id } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'SOURCE_UNAVAILABLE', message: 'Unexpected server error', requestId: req.id } });
  });

  registerRoutes(app, o.db, { dataDir: o.dataDir, version: VERSION });

  const webDist = path.join(ROOT, 'apps/web/dist');
  if (o.serveStatic && fs.existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such route', requestId: req.id } })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}

async function main() {
  const host = process.env.LISTEN_HOST ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.error(`Refusing to listen on ${host}: Blackhole is loopback-only until a LAN threat model is approved (D-01).`);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 4317);
  const dataDir = path.resolve(ROOT, process.env.DATA_DIR ?? 'data');
  const dbFile = process.env.DATABASE_PATH ? path.resolve(ROOT, process.env.DATABASE_PATH) : path.join(dataDir, 'blackhole.sqlite');
  const prod = process.env.NODE_ENV === 'production';
  const db = openDb(dbFile);
  backfillPlayPlatforms(db);
  const app = buildServer({
    db,
    host,
    port,
    dataDir,
    serveStatic: prod,
    extraOrigins: prod ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'],
  });
  await app.listen({ host, port });
  scheduleTvMaintenance(db, dataDir, (m) => app.log.info(m));
  console.log(`\n  BLACKHOLE v${VERSION}  →  http://${host}:${port}${prod ? '' : '  (API only; UI at http://localhost:5173)'}\n  data: ${dbFile}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

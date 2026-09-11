import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import env from './config/env.js';
import { healthcheck } from './db/pool.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { ok } from './utils/http.js';

import authRoutes from './routes/auth.js';
import individualRoutes from './routes/individual.js';
import institutionRoutes from './routes/institution.js';
import businessRoutes from './routes/business.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import integrationRoutes, { clickRouter } from './routes/integrations.js';
import webhookRoutes from './routes/webhooks.js';
import { startScheduledJobs } from './jobs/scheduler.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: false, // The SPA is served separately.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(compression());
app.use(
  cors({
    origin: env.isProd ? env.appUrl.split(',').map((s) => s.trim()) : true,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.isProd ? 'combined' : 'dev'));

/* ---- rate limits (spec 8.2) ---- */
const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Too many requests. Please slow down.' },
});
// Auth is the most attacked surface, so it gets the tightest budget.
// Development uses a looser limit so automated UI runs are not blocked.
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isProd ? 20 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    success: false,
    data: null,
    error: 'Too many attempts. Wait a minute and try again.',
  },
});
const integrationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Rate limit exceeded' },
});
// Payment callbacks get a generous budget: the provider retries on failure and
// throttling a genuine callback would delay money reaching a partner.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 1200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, data: null, error: 'Rate limit exceeded' },
});

const API = '/api/v1';

app.get('/health', async (req, res) => {
  const db = await healthcheck().catch(() => false);
  return res.status(db ? 200 : 503).json({
    success: db,
    data: { status: db ? 'ok' : 'degraded', database: db ? 'up' : 'down', uptime: process.uptime() },
    error: db ? null : 'Database unavailable',
  });
});

app.use(`${API}/auth`, authLimiter, authRoutes);
app.use(`${API}/public`, publicLimiter, publicRoutes);
app.use(`${API}/individual`, individualRoutes);
app.use(`${API}/institution`, institutionRoutes);
app.use(`${API}/business`, businessRoutes);
app.use(`${API}/admin`, adminRoutes);
app.use(`${API}/integrations`, integrationLimiter, integrationRoutes);

// Payment gateway callbacks. Unauthenticated by design: the request is proven
// genuine by its HMAC checksum and, optionally, a source-IP allowlist.
app.use(`${API}/webhooks`, webhookLimiter, webhookRoutes);

// Short referral links: pazo.africa/r/AMINA07
app.use('/r', publicLimiter, clickRouter);

app.get(`${API}/integrations/docs`, (req, res) =>
  ok(res, {
    base_url: `${req.protocol}://${req.get('host')}${API}`,
    auth: 'Authorization: Bearer {api_key}',
    endpoints: [
      {
        method: 'POST',
        path: '/integrations/referrals/register',
        body: { referral_code: 'AMINA07', tourist_id: 'tvl_8842' },
        returns: { partner_id: 'uuid', partner_name: 'string', commission_rate: 0.08 },
      },
      {
        method: 'POST',
        path: '/integrations/transactions',
        body: {
          tourist_id: 'tvl_8842',
          amount_tzs: 30840,
          bundle_type: 'Tanzania 7-Day 5GB',
          transaction_type: 'first_purchase',
          transaction_reference: 'TVL-90210',
        },
        returns: { commission_tzs: 2467, platform_fee_tzs: 308, commission_status: 'paid' },
      },
      { method: 'GET', path: '/integrations/verify', returns: { valid: true } },
    ],
    notes: [
      'All amounts are integer Tanzanian shillings.',
      'Retry on 5xx up to three times with backoff of 5s, 15s then 45s.',
      'transaction_reference must be unique; repeats return the original result and pay only once.',
    ],
  }),
);

/**
 * Serve the built front end from the same process when it is present.
 *
 * On a platform like Railway this makes the whole product one deployment on
 * one URL, with no cross-origin setup. On a server where nginx serves the
 * static files, this block simply never triggers.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
  console.log(`  Serving the web app from ${WEB_DIST}`);

  // Hashed asset filenames never change, so they can be cached hard.
  app.use(
    '/assets',
    express.static(path.join(WEB_DIST, 'assets'), {
      immutable: true,
      maxAge: '1y',
    }),
  );
  app.use(express.static(WEB_DIST, { index: false, maxAge: '1h' }));

  // Any path that is not an API route is handled by the single-page app.
  app.get(/^(?!\/api|\/r\/|\/health).*/, (req, res) =>
    res.sendFile(path.join(WEB_DIST, 'index.html')),
  );
}

app.use(notFoundHandler);
app.use(errorHandler);

// Hosting platforms assign the port and require binding on all interfaces.
const server = app.listen(env.port, '0.0.0.0', () => {
  console.log(`\n  Pazo API listening on http://localhost:${env.port}`);
  console.log(`  Environment: ${env.nodeEnv}`);
  console.log(`  Database:    ${env.db.user}@${env.db.host}:${env.db.port}/${env.db.database}\n`);
  startScheduledJobs();
});

const shutdown = (signal) => () => {
  console.log(`\n[pazo] ${signal} received, shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('SIGINT', shutdown('SIGINT'));

export default app;

import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { MOLTBOT_PORT } from '../config';
import { findExistingMoltbotProcess, ensureMoltbotGateway } from '../gateway';

/**
 * Public routes - NO Cloudflare Access authentication required
 * 
 * These routes are mounted BEFORE the auth middleware is applied.
 * Includes: health checks, static assets, and public API endpoints.
 */
const publicRoutes = new Hono<AppEnv>();

// GET /sandbox-health - Health check endpoint
publicRoutes.get('/sandbox-health', (c) => {
  return c.json({
    status: 'ok',
    service: 'moltbot-sandbox',
    gateway_port: MOLTBOT_PORT,
  });
});

// GET /logo.png - Serve logo from ASSETS binding
publicRoutes.get('/logo.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /logo-small.png - Serve small logo from ASSETS binding
publicRoutes.get('/logo-small.png', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

// GET /api/status - Public health check for gateway status (no auth required)
publicRoutes.get('/api/status', async (c) => {
  const sandbox = c.get('sandbox');
  
  try {
    const process = await findExistingMoltbotProcess(sandbox);
    if (!process) {
      return c.json({ ok: false, status: 'not_running' });
    }
    
    // Process exists, check if it's actually responding
    // Try to reach the gateway with a short timeout
    try {
      await process.waitForPort(18789, { mode: 'tcp', timeout: 5000 });
      return c.json({ ok: true, status: 'running', processId: process.id });
    } catch {
      return c.json({ ok: false, status: 'not_responding', processId: process.id });
    }
  } catch (err) {
    return c.json({ ok: false, status: 'error', error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// GET /_admin/assets/* - Admin UI static assets (CSS, JS need to load for login redirect)
// Assets are built to dist/client with base "/_admin/"
publicRoutes.get('/_admin/assets/*', async (c) => {
  const url = new URL(c.req.url);
  // Rewrite /_admin/assets/* to /assets/* for the ASSETS binding
  const assetPath = url.pathname.replace('/_admin/assets/', '/assets/');
  const assetUrl = new URL(assetPath, url.origin);
  return c.env.ASSETS.fetch(new Request(assetUrl.toString(), c.req.raw));
});

// =============================================================================
// WEBHOOK ROUTES: Public endpoints for messaging integrations
// These bypass Cloudflare Access auth and proxy directly to the gateway
// =============================================================================

/**
 * Helper to proxy webhook requests to the moltbot gateway
 */
async function proxyWebhook(c: any): Promise<Response> {
  const sandbox = c.get('sandbox');
  const request = c.req.raw;

  try {
    // Ensure gateway is running
    await ensureMoltbotGateway(sandbox, c.env);

    // Proxy the request to the gateway
    const response = await sandbox.containerFetch(request, MOLTBOT_PORT);
    return response;
  } catch (error) {
    console.error('[WEBHOOK] Failed to proxy:', error);
    return c.json({
      error: 'Gateway not available',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 503);
  }
}

// POST /telegram - Telegram Bot webhook (legacy path)
publicRoutes.post('/telegram', proxyWebhook);

// POST /telegram-webhook - Telegram Bot webhook (OpenClaw standard path)
publicRoutes.post('/telegram-webhook', proxyWebhook);

// POST /slack/events - Slack Events API webhook
publicRoutes.post('/slack/events', proxyWebhook);

// POST /slack/interactions - Slack Interactivity webhook
publicRoutes.post('/slack/interactions', proxyWebhook);

// POST /slack/commands - Slack Slash Commands webhook
publicRoutes.post('/slack/commands', proxyWebhook);

// POST /discord/interactions - Discord Interactions webhook
publicRoutes.post('/discord/interactions', proxyWebhook);

export { publicRoutes };

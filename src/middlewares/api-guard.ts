/**
 * Protects the public REST API now that Product Management has no sign-in.
 *
 * Anyone may read products, check out and manage products (Public role, as in
 * Guide 1), so this middleware limits how much one visitor can do:
 *
 * 1. Rate limiting per visitor IP (fixed windows, kept in memory):
 *    - product changes and image uploads: 30 per minute and 200 per hour
 *    - checkout: 10 per minute
 *    - everything else under /api (reads): 300 per minute
 *    Over the limit the API answers 429 with a Retry-After header.
 *
 * 2. Write origin check: create / update / delete / upload / checkout requests
 *    are refused unless they come from the storefront (FRONTEND_URL). Browsers
 *    always send the Origin header on these requests, so a page on another
 *    site cannot use a visitor's browser to change products.
 *
 * The admin panel (/admin, /content-manager, /upload) is not affected: it has
 * its own sign-in and does not use /api.
 */

import type { Core } from '@strapi/strapi';

type Rule = { name: string; max: number; windowMs: number };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const WRITE_RULES: Rule[] = [
  { name: 'write-min', max: 30, windowMs: MINUTE },
  { name: 'write-hour', max: 200, windowMs: HOUR },
];
const CHECKOUT_RULES: Rule[] = [{ name: 'checkout', max: 10, windowMs: MINUTE }];
const READ_RULES: Rule[] = [{ name: 'read', max: 300, windowMs: MINUTE }];

// Stop the map from growing without bound if many IPs hit the API.
const MAX_TRACKED_KEYS = 50_000;

const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

export default (_config: unknown, { strapi }: { strapi: Core.Strapi }) => {
  const hits = new Map<string, { count: number; resetAt: number }>();

  // Drop expired windows once a minute (unref: never keeps the process alive).
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, MINUTE).unref();

  const allowedOrigins = new Set(
    String(process.env.FRONTEND_URL || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );
  const isProxied = process.env.IS_PROXIED === 'true';

  // On Render, Cloudflare sits in front of the app and always overwrites
  // CF-Connecting-IP with the real visitor address, so it cannot be faked the
  // way the first X-Forwarded-For entry can.
  function getClientIp(ctx: any) {
    const cfIp = isProxied ? String(ctx.get('cf-connecting-ip') || '').trim() : '';
    return cfIp || ctx.request.ip || 'unknown';
  }

  // Counts this request against every rule; returns seconds to wait when blocked.
  function consume(ip: string, rules: Rule[]) {
    const now = Date.now();
    let retryAfter = 0;

    for (const rule of rules) {
      const key = `${rule.name}:${ip}`;
      let entry = hits.get(key);

      if (!entry || entry.resetAt <= now) {
        if (!entry && hits.size >= MAX_TRACKED_KEYS) hits.clear();
        entry = { count: 0, resetAt: now + rule.windowMs };
        hits.set(key, entry);
      }

      entry.count++;
      if (entry.count > rule.max) {
        retryAfter = Math.max(retryAfter, Math.ceil((entry.resetAt - now) / 1000));
      }
    }

    return retryAfter;
  }

  function reject(ctx: any, status: number, name: string, message: string) {
    ctx.status = status;
    ctx.body = { data: null, error: { status, name, message, details: {} } };
  }

  return async (ctx: any, next: () => Promise<void>) => {
    const path: string = ctx.path.toLowerCase().replace(/\/+$/, '');

    if (!path.startsWith('/api/') || ctx.method === 'OPTIONS') {
      return next();
    }

    const isWrite = WRITE_METHODS.includes(ctx.method);
    const isCheckout = path === '/api/products/checkout';

    if (isWrite) {
      const origin = String(ctx.get('origin') || '').replace(/\/+$/, '');
      if (!allowedOrigins.has(origin)) {
        strapi.log.warn(`[api-guard] Blocked ${ctx.method} ${ctx.path} from origin "${origin || 'none'}"`);
        return reject(ctx, 403, 'ForbiddenError', 'Changes are only accepted from the MineKartt storefront.');
      }
    }

    const rules = isCheckout ? CHECKOUT_RULES : isWrite ? WRITE_RULES : READ_RULES;
    const ip = getClientIp(ctx);
    const retryAfter = consume(ip, rules);

    if (retryAfter > 0) {
      ctx.set('Retry-After', String(retryAfter));
      strapi.log.warn(`[api-guard] Rate limit hit: ${ctx.method} ${ctx.path} from ${ip}`);
      const wait = retryAfter >= 120 ? `${Math.ceil(retryAfter / 60)} minutes` : `${retryAfter} seconds`;
      return reject(ctx, 429, 'RateLimitError', `Too many requests. Please wait ${wait} and try again.`);
    }

    return next();
  };
};

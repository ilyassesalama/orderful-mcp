/**
 * HTTP middleware for hosted (remote) mode.
 *
 * Each user passes their own Orderful API key as a Bearer token:
 *
 *   Authorization: Bearer <orderful-api-key>
 *
 * Provides: API-key extraction, per-IP rate limiting, request size limits,
 * and basic security headers. The key itself is validated by Orderful on
 * the first API call — we only check that one was supplied.
 */
import type { Request, Response, NextFunction } from 'express';

// ── Configuration ───────────────────────────────

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // per window
export const JSON_LIMIT = '1mb';

// ── Rate Limiter (in-memory, per-IP) ────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX_REQUESTS;
}

// Periodic cleanup to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// ── API key extraction ──────────────────────────

/**
 * Pull the Orderful API key out of the `Authorization: Bearer <key>` header.
 * Returns undefined if absent or malformed.
 */
export function getApiKeyFromRequest(req: Request): string | undefined {
  const header = req.headers['authorization'];
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

// ── Security Headers Middleware ──────────────────

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Powered-By');
  next();
}

// ── Auth + Rate Limit Middleware ─────────────────

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    res.status(413).json({ error: 'Request too large' });
    return;
  }

  if (!getApiKeyFromRequest(req)) {
    res.status(401).json({ error: 'Missing or malformed Authorization header. Expected: Authorization: Bearer <orderful-api-key>' });
    return;
  }

  next();
}

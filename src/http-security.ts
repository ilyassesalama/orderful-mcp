// Transport hardening for HTTP mode: per-IP rate limiting, size limits, and
// security headers. Authentication is handled separately by OAuth.
import type { Request, Response, NextFunction } from 'express';

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // per window
export const JSON_LIMIT = '1mb';

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

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.removeHeader('X-Powered-By');
  next();
}

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
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

  next();
}

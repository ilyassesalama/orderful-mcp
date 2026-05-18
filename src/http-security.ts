/**
 * HTTP Security Middleware for MCP Servers
 *
 * Provides:
 * 1. HMAC request authentication (shared secret between Integriverse ↔ MCP server)
 * 2. Per-request credential decryption from signed header
 * 3. Rate limiting (per-IP, sliding window)
 * 4. Request size limits
 * 5. Security headers
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

// ── Configuration ───────────────────────────────

const MCP_SHARED_SECRET = process.env.MCP_SHARED_SECRET;
const MAX_BODY_SIZE = 1024 * 1024; // 1 MB
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120; // per window

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

// ── HMAC Verification ───────────────────────────

/**
 * Verify HMAC-SHA256 signature with timing-safe comparison.
 *
 * Integriverse signs: HMAC-SHA256(MCP_SHARED_SECRET, x-mcp-credentials)
 * and sends signature in `x-mcp-signature` header.
 */
function verifySignature(body: string, signature: string): boolean {
  if (!MCP_SHARED_SECRET) return false;

  const expected = createHmac('sha256', MCP_SHARED_SECRET)
    .update(body)
    .digest('hex');

  try {
    return timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

// ── Parse Credentials ───────────────────────────

/**
 * Parse credentials from the x-mcp-credentials header.
 * Returns empty object if header is missing or invalid.
 */
export function parseCredentials(req: Request): Record<string, string> {
  const header = req.headers['x-mcp-credentials'] as string | undefined;
  if (!header) return {};

  try {
    const parsed = JSON.parse(header);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    // Ensure all values are strings
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
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
  // 1. Rate limit check
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(clientIp)) {
    res.status(429).json({ error: 'Rate limit exceeded' });
    return;
  }

  // 2. Request size check (defense-in-depth — express.json limit is primary)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_BODY_SIZE) {
    res.status(413).json({ error: 'Request too large' });
    return;
  }

  // 3. HMAC signature verification
  if (!MCP_SHARED_SECRET) {
    // If no secret configured, reject all requests (fail closed)
    console.error('[SECURITY] MCP_SHARED_SECRET not configured — rejecting request');
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const signature = req.headers['x-mcp-signature'] as string | undefined;
  const credentials = req.headers['x-mcp-credentials'] as string | undefined;
  if (!signature || !credentials) {
    res.status(401).json({ error: 'Missing authentication headers' });
    return;
  }

  // Verify HMAC of the credentials header (matches what the client signs)
  if (!verifySignature(credentials, signature)) {
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

// ── Express JSON with size limit ────────────────

export const JSON_LIMIT = '1mb';

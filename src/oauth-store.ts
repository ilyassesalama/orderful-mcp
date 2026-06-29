/**
 * OAuth state store for hosted (remote) mode.
 *
 * Holds the durable OAuth state that outlives a single request: registered
 * clients, authorization codes (single-use), and access/refresh tokens. Each
 * member's Orderful API key is encrypted at rest (AES-256-GCM) and mapped to
 * the tokens we issue.
 *
 * Backend is chosen at startup: if REDIS_URL is set the state lives in Redis
 * (survives restarts, shared across instances — the production setup, e.g.
 * Railway's Redis add-on); otherwise it falls back to an in-memory map (fine
 * for local dev and single-instance deploys, but cleared on restart).
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export const AUTH_CODE_TTL_MS = 60_000; // 1 minute
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
const CLIENT_TTL_MS = 365 * 24 * 60 * 60_000; // clients effectively persist

// Uses OAUTH_ENCRYPTION_KEY if set, otherwise a random per-process key. A random
// key means tokens can't be decrypted after a restart — set OAUTH_ENCRYPTION_KEY
// (stable, secret) so tokens stored in Redis stay valid across deploys.
const ENC_KEY = createHash('sha256')
  .update(process.env.OAUTH_ENCRYPTION_KEY || randomBytes(32).toString('hex'))
  .digest();

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

function decrypt(blob: string): string {
  const [ivB64, tagB64, dataB64] = blob.split('.');
  const decipher = createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Minimal key/value contract the store needs. `take` is an atomic get-and-delete
 * (used to enforce single-use auth codes and refresh-token rotation).
 */
interface Kv {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  take(key: string): Promise<string | undefined>;
  del(key: string): Promise<void>;
}

const NAMESPACE = process.env.OAUTH_NAMESPACE || 'orderful-mcp';
const PREFIX = `${NAMESPACE}:`;

class MemoryKv implements Kv {
  private map = new Map<string, { value: string; expiresAt: number }>();
  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.map) if (v.expiresAt < now) this.map.delete(k);
    }, 5 * 60_000).unref();
  }
  async get(key: string) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }
  async set(key: string, value: string, ttlMs: number) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
  async take(key: string) {
    const value = await this.get(key);
    this.map.delete(key);
    return value;
  }
  async del(key: string) {
    this.map.delete(key);
  }
}

class RedisKv implements Kv {
  private redis: Redis;
  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 3 });
    this.redis.on('error', (e: Error) => console.error('[oauth-store] redis error:', e.message));
  }
  async get(key: string) {
    return (await this.redis.get(key)) ?? undefined;
  }
  async set(key: string, value: string, ttlMs: number) {
    await this.redis.set(key, value, 'PX', ttlMs);
  }
  async take(key: string) {
    // GETDEL is atomic — prevents an auth code / refresh token being used twice.
    return (await this.redis.getdel(key)) ?? undefined;
  }
  async del(key: string) {
    await this.redis.del(key);
  }
}

const kv: Kv = process.env.REDIS_URL ? new RedisKv(process.env.REDIS_URL) : new MemoryKv();
console.error(
  `[oauth-store] backend: ${process.env.REDIS_URL ? 'redis' : 'in-memory'}, namespace: ${NAMESPACE}`,
);

const clientKey = (id: string) => `${PREFIX}client:${id}`;
const codeKey = (code: string) => `${PREFIX}code:${code}`;
const accessKey = (token: string) => `${PREFIX}at:${token}`;
const refreshKey = (token: string) => `${PREFIX}rt:${token}`;

interface AuthCodeRecord {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  scopes: string[];
  encKey: string;
  expiresAt: number;
}

interface TokenRecord {
  clientId: string;
  scopes: string[];
  resource?: string;
  encKey: string;
  expiresAt: number;
}

export async function saveClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
  await kv.set(clientKey(client.client_id), JSON.stringify(client), CLIENT_TTL_MS);
  return client;
}

export async function getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  const raw = await kv.get(clientKey(clientId));
  return raw ? (JSON.parse(raw) as OAuthClientInformationFull) : undefined;
}

export async function createAuthCode(input: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  scopes: string[];
  orderfulKey: string;
}): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  const rec: AuthCodeRecord = {
    clientId: input.clientId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    resource: input.resource,
    scopes: input.scopes,
    encKey: encrypt(input.orderfulKey),
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  };
  await kv.set(codeKey(code), JSON.stringify(rec), AUTH_CODE_TTL_MS);
  return code;
}

export async function peekAuthCodeChallenge(code: string): Promise<string | undefined> {
  const raw = await kv.get(codeKey(code));
  return raw ? (JSON.parse(raw) as AuthCodeRecord).codeChallenge : undefined;
}

/** Consume an auth code (single-use). Returns the record + decrypted key, or undefined. */
export async function consumeAuthCode(code: string): Promise<
  | { clientId: string; redirectUri: string; resource?: string; scopes: string[]; orderfulKey: string }
  | undefined
> {
  const raw = await kv.take(codeKey(code));
  if (!raw) return undefined;
  const rec = JSON.parse(raw) as AuthCodeRecord;
  if (rec.expiresAt < Date.now()) return undefined;
  return {
    clientId: rec.clientId,
    redirectUri: rec.redirectUri,
    resource: rec.resource,
    scopes: rec.scopes,
    orderfulKey: decrypt(rec.encKey),
  };
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export async function issueTokens(input: {
  clientId: string;
  scopes: string[];
  resource?: string;
  orderfulKey: string;
}): Promise<IssuedTokens> {
  const encKey = encrypt(input.orderfulKey);
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const now = Date.now();

  await kv.set(
    accessKey(accessToken),
    JSON.stringify({ ...input, encKey, expiresAt: now + ACCESS_TOKEN_TTL_MS } satisfies TokenRecord),
    ACCESS_TOKEN_TTL_MS,
  );
  await kv.set(
    refreshKey(refreshToken),
    JSON.stringify({ ...input, encKey, expiresAt: now + REFRESH_TOKEN_TTL_MS } satisfies TokenRecord),
    REFRESH_TOKEN_TTL_MS,
  );

  return { accessToken, refreshToken, expiresInSec: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export interface VerifiedToken {
  clientId: string;
  scopes: string[];
  resource?: string;
  orderfulKey: string;
  expiresAtSec: number;
}

export async function verifyAccessToken(token: string): Promise<VerifiedToken | undefined> {
  const raw = await kv.get(accessKey(token));
  if (!raw) return undefined;
  const rec = JSON.parse(raw) as TokenRecord;
  if (rec.expiresAt < Date.now()) {
    await kv.del(accessKey(token));
    return undefined;
  }
  return {
    clientId: rec.clientId,
    scopes: rec.scopes,
    resource: rec.resource,
    orderfulKey: decrypt(rec.encKey),
    expiresAtSec: Math.floor(rec.expiresAt / 1000),
  };
}

/** Rotate a refresh token into a fresh access/refresh pair. */
export async function consumeRefreshToken(token: string): Promise<
  { clientId: string; scopes: string[]; resource?: string; orderfulKey: string } | undefined
> {
  const raw = await kv.take(refreshKey(token));
  if (!raw) return undefined;
  const rec = JSON.parse(raw) as TokenRecord;
  if (rec.expiresAt < Date.now()) return undefined;
  return {
    clientId: rec.clientId,
    scopes: rec.scopes,
    resource: rec.resource,
    orderfulKey: decrypt(rec.encKey),
  };
}

export async function revokeToken(token: string): Promise<void> {
  await kv.del(accessKey(token));
  await kv.del(refreshKey(token));
}

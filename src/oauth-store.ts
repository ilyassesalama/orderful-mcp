/**
 * OAuth state store for hosted (remote) mode.
 *
 * Holds the four kinds of durable OAuth state that outlive a single request:
 *   - registered clients   (client_id -> client metadata)
 *   - authorization codes   (~60s, single-use)
 *   - access tokens         (~1h)
 *   - refresh tokens        (~30d)
 *
 * Each member's Orderful API key is captured during the authorization flow and
 * mapped to the tokens we issue. The key is the actual credential, so it is
 * encrypted at rest with AES-256-GCM — this matters once this store is backed
 * by Redis/a DB (see note below); in-memory it is defence-in-depth.
 *
 * This implementation is a single-instance, in-memory store. To run multiple
 * instances behind a load balancer, replace the `Map`s with a shared backend
 * (Redis, Postgres, …) — the public surface here is intentionally small so
 * that swap is mechanical. Keep the encrypt/decrypt calls in place when you do.
 */
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export const AUTH_CODE_TTL_MS = 60_000; // 1 minute
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days

// Uses OAUTH_ENCRYPTION_KEY if set, otherwise a random per-process key. With a
// random key, tokens do not survive a restart — fine for the in-memory store,
// but set OAUTH_ENCRYPTION_KEY (and a shared backend) for persistence.
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

const clients = new Map<string, OAuthClientInformationFull>();
const authCodes = new Map<string, AuthCodeRecord>();
const accessTokens = new Map<string, TokenRecord>();
const refreshTokens = new Map<string, TokenRecord>();

export function saveClient(client: OAuthClientInformationFull): OAuthClientInformationFull {
  clients.set(client.client_id, client);
  return client;
}

export function getClient(clientId: string): OAuthClientInformationFull | undefined {
  return clients.get(clientId);
}

export function createAuthCode(input: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  scopes: string[];
  orderfulKey: string;
}): string {
  const code = randomBytes(32).toString('base64url');
  authCodes.set(code, {
    clientId: input.clientId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    resource: input.resource,
    scopes: input.scopes,
    encKey: encrypt(input.orderfulKey),
    expiresAt: Date.now() + AUTH_CODE_TTL_MS,
  });
  return code;
}

export function peekAuthCodeChallenge(code: string): string | undefined {
  const rec = authCodes.get(code);
  if (!rec || rec.expiresAt < Date.now()) return undefined;
  return rec.codeChallenge;
}

/** Consume an auth code (single-use). Returns the record + decrypted key, or undefined. */
export function consumeAuthCode(code: string):
  | { clientId: string; redirectUri: string; resource?: string; scopes: string[]; orderfulKey: string }
  | undefined {
  const rec = authCodes.get(code);
  authCodes.delete(code); // one-time use regardless of validity
  if (!rec || rec.expiresAt < Date.now()) return undefined;
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

export function issueTokens(input: {
  clientId: string;
  scopes: string[];
  resource?: string;
  orderfulKey: string;
}): IssuedTokens {
  const encKey = encrypt(input.orderfulKey);
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');

  accessTokens.set(accessToken, {
    clientId: input.clientId,
    scopes: input.scopes,
    resource: input.resource,
    encKey,
    expiresAt: Date.now() + ACCESS_TOKEN_TTL_MS,
  });
  refreshTokens.set(refreshToken, {
    clientId: input.clientId,
    scopes: input.scopes,
    resource: input.resource,
    encKey,
    expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS,
  });

  return { accessToken, refreshToken, expiresInSec: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export interface VerifiedToken {
  clientId: string;
  scopes: string[];
  resource?: string;
  orderfulKey: string;
  expiresAtSec: number;
}

export function verifyAccessToken(token: string): VerifiedToken | undefined {
  const rec = accessTokens.get(token);
  if (!rec) return undefined;
  if (rec.expiresAt < Date.now()) {
    accessTokens.delete(token);
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
export function consumeRefreshToken(token: string):
  | { clientId: string; scopes: string[]; resource?: string; orderfulKey: string }
  | undefined {
  const rec = refreshTokens.get(token);
  if (!rec || rec.expiresAt < Date.now()) {
    refreshTokens.delete(token);
    return undefined;
  }
  refreshTokens.delete(token); // rotate
  return {
    clientId: rec.clientId,
    scopes: rec.scopes,
    resource: rec.resource,
    orderfulKey: decrypt(rec.encKey),
  };
}

export function revokeToken(token: string): void {
  accessTokens.delete(token);
  refreshTokens.delete(token);
}

// Sweep expired entries periodically so the maps don't grow unbounded.
const SWEEP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authCodes) if (v.expiresAt < now) authCodes.delete(k);
  for (const [k, v] of accessTokens) if (v.expiresAt < now) accessTokens.delete(k);
  for (const [k, v] of refreshTokens) if (v.expiresAt < now) refreshTokens.delete(k);
}, SWEEP_INTERVAL_MS).unref();

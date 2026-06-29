// OAuth state store: Redis when REDIS_URL is set (shared, survives restarts),
// otherwise an in-memory map. Member API keys are encrypted at rest.
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

export const AUTH_CODE_TTL_MS = 60_000; // 1 minute
export const ACCESS_TOKEN_TTL_MS = 60 * 60_000; // 1 hour
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000; // 30 days
const CLIENT_TTL_MS = 365 * 24 * 60 * 60_000; // clients effectively persist

// Set a stable OAUTH_ENCRYPTION_KEY in production, or tokens won't survive a restart.
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

interface Kv {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  take(key: string): Promise<string | undefined>; // atomic get-and-delete
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
const profileKey = (id: string) => `${PREFIX}profile:${id}`;
const connectKey = (token: string) => `${PREFIX}connect:${token}`;

// A profile holds one member's connected orgs (each with its own encrypted key)
// and which one is active. Tokens reference a profileId, not a raw key.
interface OrgEntry {
  orgId: string;
  orgName: string;
  encKey: string;
}
interface Profile {
  organizations: OrgEntry[];
  activeOrgId?: string;
}

interface AuthCodeRecord {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  scopes: string[];
  profileId: string;
  expiresAt: number;
}

interface TokenRecord {
  clientId: string;
  scopes: string[];
  resource?: string;
  profileId: string;
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

// ── Profiles ─────────────────────────────────────
async function loadProfile(profileId: string): Promise<Profile | undefined> {
  const raw = await kv.get(profileKey(profileId));
  return raw ? (JSON.parse(raw) as Profile) : undefined;
}
async function saveProfile(profileId: string, profile: Profile): Promise<void> {
  await kv.set(profileKey(profileId), JSON.stringify(profile), CLIENT_TTL_MS);
}

export async function createProfile(orderfulKey: string, orgId: string, orgName: string): Promise<string> {
  const profileId = randomBytes(24).toString('base64url');
  await saveProfile(profileId, {
    organizations: [{ orgId, orgName, encKey: encrypt(orderfulKey) }],
    activeOrgId: orgId,
  });
  return profileId;
}

/** Add (or replace) an org in a profile and make it active. */
export async function addOrgToProfile(
  profileId: string,
  orgId: string,
  orgName: string,
  orderfulKey: string,
): Promise<boolean> {
  const profile = await loadProfile(profileId);
  if (!profile) return false;
  const encKey = encrypt(orderfulKey);
  const existing = profile.organizations.find((o) => o.orgId === orgId);
  if (existing) {
    existing.orgName = orgName;
    existing.encKey = encKey;
  } else {
    profile.organizations.push({ orgId, orgName, encKey });
  }
  profile.activeOrgId = orgId;
  await saveProfile(profileId, profile);
  return true;
}

export async function setActiveOrg(profileId: string, orgId: string): Promise<boolean> {
  const profile = await loadProfile(profileId);
  if (!profile || !profile.organizations.some((o) => o.orgId === orgId)) return false;
  profile.activeOrgId = orgId;
  await saveProfile(profileId, profile);
  return true;
}

/** Remove an org; if it was active, fall back to the first remaining one. */
export async function removeOrgFromProfile(
  profileId: string,
  orgId: string,
): Promise<{ removed: boolean; activeOrgId?: string }> {
  const profile = await loadProfile(profileId);
  if (!profile) return { removed: false };
  const before = profile.organizations.length;
  profile.organizations = profile.organizations.filter((o) => o.orgId !== orgId);
  if (profile.organizations.length === before) return { removed: false, activeOrgId: profile.activeOrgId };
  if (profile.activeOrgId === orgId) {
    profile.activeOrgId = profile.organizations[0]?.orgId;
  }
  await saveProfile(profileId, profile);
  return { removed: true, activeOrgId: profile.activeOrgId };
}

export interface OrgSummary {
  orgId: string;
  orgName: string;
  active: boolean;
}

export async function listOrgs(profileId: string): Promise<OrgSummary[] | undefined> {
  const profile = await loadProfile(profileId);
  if (!profile) return undefined;
  return profile.organizations.map((o) => ({
    orgId: o.orgId,
    orgName: o.orgName,
    active: o.orgId === profile.activeOrgId,
  }));
}

async function getActiveKey(profileId: string): Promise<string | undefined> {
  const profile = await loadProfile(profileId);
  if (!profile) return undefined;
  const active = profile.organizations.find((o) => o.orgId === profile.activeOrgId);
  return active ? decrypt(active.encKey) : undefined;
}

// ── Authorization codes ──────────────────────────
export async function createAuthCode(input: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  resource?: string;
  scopes: string[];
  profileId: string;
}): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  const rec: AuthCodeRecord = { ...input, expiresAt: Date.now() + AUTH_CODE_TTL_MS };
  await kv.set(codeKey(code), JSON.stringify(rec), AUTH_CODE_TTL_MS);
  return code;
}

export async function peekAuthCodeChallenge(code: string): Promise<string | undefined> {
  const raw = await kv.get(codeKey(code));
  return raw ? (JSON.parse(raw) as AuthCodeRecord).codeChallenge : undefined;
}

export async function consumeAuthCode(code: string): Promise<
  | { clientId: string; redirectUri: string; resource?: string; scopes: string[]; profileId: string }
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
    profileId: rec.profileId,
  };
}

// ── Tokens ───────────────────────────────────────
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSec: number;
}

export async function issueTokens(input: {
  clientId: string;
  scopes: string[];
  resource?: string;
  profileId: string;
}): Promise<IssuedTokens> {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  const now = Date.now();

  await kv.set(
    accessKey(accessToken),
    JSON.stringify({ ...input, expiresAt: now + ACCESS_TOKEN_TTL_MS } satisfies TokenRecord),
    ACCESS_TOKEN_TTL_MS,
  );
  await kv.set(
    refreshKey(refreshToken),
    JSON.stringify({ ...input, expiresAt: now + REFRESH_TOKEN_TTL_MS } satisfies TokenRecord),
    REFRESH_TOKEN_TTL_MS,
  );

  return { accessToken, refreshToken, expiresInSec: Math.floor(ACCESS_TOKEN_TTL_MS / 1000) };
}

export interface VerifiedToken {
  clientId: string;
  scopes: string[];
  resource?: string;
  profileId: string;
  orderfulKey?: string;
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
    profileId: rec.profileId,
    orderfulKey: await getActiveKey(rec.profileId),
    expiresAtSec: Math.floor(rec.expiresAt / 1000),
  };
}

export async function consumeRefreshToken(token: string): Promise<
  { clientId: string; scopes: string[]; resource?: string; profileId: string } | undefined
> {
  const raw = await kv.take(refreshKey(token));
  if (!raw) return undefined;
  const rec = JSON.parse(raw) as TokenRecord;
  if (rec.expiresAt < Date.now()) return undefined;
  return {
    clientId: rec.clientId,
    scopes: rec.scopes,
    resource: rec.resource,
    profileId: rec.profileId,
  };
}

export async function revokeToken(token: string): Promise<void> {
  await kv.del(accessKey(token));
  await kv.del(refreshKey(token));
}

// ── Connect links (add another org to an existing profile) ──
const CONNECT_TOKEN_TTL_MS = 15 * 60_000; // 15 minutes

export async function createConnectToken(profileId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await kv.set(connectKey(token), profileId, CONNECT_TOKEN_TTL_MS);
  return token;
}

export async function peekConnectToken(token: string): Promise<string | undefined> {
  return kv.get(connectKey(token));
}

export async function consumeConnectToken(token: string): Promise<string | undefined> {
  return kv.take(connectKey(token));
}

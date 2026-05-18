/**
 * Per-request credential store using AsyncLocalStorage.
 *
 * In HTTP mode, each request runs inside its own async context with
 * the user's decrypted credentials. This avoids global state (process.env)
 * and is fully concurrency-safe.
 *
 * In stdio mode, the store is empty — callers fall back to process.env.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export const credentialStore = new AsyncLocalStorage<Record<string, string>>();

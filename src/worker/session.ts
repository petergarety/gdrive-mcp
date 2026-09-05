import { Env } from '../types/index.js';
import { generateSecureToken } from './crypto.js';

/**
 * Session, OAuth-state, and API-key lifecycle for the Cloudflare Workers
 * runtime. All persistence goes through the env's KV namespaces:
 *   - TOKEN_STORE: sessions, API keys, email→key mapping
 *   - CACHE:       short-lived OAuth state nonces
 */

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const OAUTH_STATE_TTL_SECONDS = 600; // 10 minutes

interface SessionData {
  userId: string;
  createdAt: number;
  expiresAt: number;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const sessionToken = generateSecureToken();
  const sessionData: SessionData = {
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  await env.TOKEN_STORE.put(`session:${sessionToken}`, JSON.stringify(sessionData), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return sessionToken;
}

export async function validateSession(env: Env, sessionToken: string): Promise<string | null> {
  const raw = await env.TOKEN_STORE.get(`session:${sessionToken}`);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as SessionData;
    if (session.expiresAt < Date.now()) {
      await env.TOKEN_STORE.delete(`session:${sessionToken}`);
      return null;
    }
    return session.userId;
  } catch {
    return null;
  }
}

export async function createOAuthState(env: Env): Promise<string> {
  const state = generateSecureToken();
  await env.CACHE.put(`oauth_state:${state}`, 'valid', {
    expirationTtl: OAUTH_STATE_TTL_SECONDS,
  });
  return state;
}

export async function validateOAuthState(env: Env, state: string): Promise<boolean> {
  const stored = await env.CACHE.get(`oauth_state:${state}`);
  if (!stored) return false;
  await env.CACHE.delete(`oauth_state:${state}`);
  return true;
}

/**
 * Stored user record indexed by API key under `api:<apiKey>` in TOKEN_STORE.
 * `userInfo` is the raw Google OAuth user profile payload; kept loose because
 * we don't control its shape and only consume `email` from it.
 */
export interface StoredUserData {
  userId: string;
  apiKey: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  userInfo?: { email?: string; [key: string]: unknown };
}

/**
 * Shape returned by `GoogleAuth.completeOAuthFlow()`. Kept here as a loose
 * structural type so `session.ts` doesn't have to import the auth module.
 */
export interface GoogleOAuthResult {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user_info?: { email?: string; [key: string]: unknown };
}

export async function createUserSession(
  env: Env,
  userId: string,
  oauthResult: GoogleOAuthResult
): Promise<string> {
  const userEmail = oauthResult.user_info?.email;

  // Invalidate all existing API keys for this user before creating a new one.
  if (userEmail) {
    await invalidateExistingApiKeys(env, userEmail);
  }

  const apiKey = generateSecureToken();
  const userData: StoredUserData = {
    userId,
    apiKey,
    accessToken: oauthResult.access_token,
    refreshToken: oauthResult.refresh_token,
    expiresAt: Date.now() + (oauthResult.expires_in ?? 3600) * 1000,
    userInfo: oauthResult.user_info,
  };

  await env.TOKEN_STORE.put(`api:${apiKey}`, JSON.stringify(userData));

  // Email→key mapping enables fast invalidation on next login.
  if (userEmail) {
    await env.TOKEN_STORE.put(`email:${userEmail}`, apiKey);
  }

  return apiKey;
}

export async function getUserDataByApiKey(
  env: Env,
  apiKey: string
): Promise<StoredUserData | null> {
  const data = await env.TOKEN_STORE.get(`api:${apiKey}`);
  if (!data) return null;
  try {
    return JSON.parse(data) as StoredUserData;
  } catch {
    return null;
  }
}

export async function updateStoredUserData(env: Env, userData: StoredUserData): Promise<void> {
  await env.TOKEN_STORE.put(`api:${userData.apiKey}`, JSON.stringify(userData));
}

/**
 * Invalidate every API key tied to a user email. Combines an O(1) email→key
 * lookup with a defensive O(n) scan to catch keys created before the email
 * mapping existed. Failures are logged but don't throw — cleanup must not
 * block new-key creation.
 */
export async function invalidateExistingApiKeys(env: Env, userEmail: string): Promise<void> {
  try {
    // Fast path: direct email→key mapping.
    const currentApiKey = await env.TOKEN_STORE.get(`email:${userEmail}`);
    if (currentApiKey) {
      await env.TOKEN_STORE.delete(`api:${currentApiKey}`);
    }

    // Defensive scan for orphaned keys (created before email mapping existed).
    const allKeys = await env.TOKEN_STORE.list({ prefix: 'api:' });
    for (const key of allKeys.keys) {
      try {
        const keyData = await env.TOKEN_STORE.get(key.name);
        if (!keyData) continue;
        const userData = JSON.parse(keyData) as StoredUserData;
        if (userData.userInfo?.email === userEmail) {
          await env.TOKEN_STORE.delete(key.name);
        }
      } catch {
        // Skip unparseable keys; continue processing the rest.
      }
    }
  } catch (error) {
    console.error('[worker] Error invalidating existing API keys:', error);
    // Don't throw — caller must still be able to create a new key.
  }
}

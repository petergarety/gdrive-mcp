import { Env } from '../types/index.js';
import { GoogleAuth } from '../auth/google.js';
import { StoredUserData, updateStoredUserData } from './session.js';

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5min before expiry

/**
 * Return a valid Google access token for the given user, refreshing it
 * transparently if the current one is within `REFRESH_BUFFER_MS` of expiry.
 * Mutates and persists `userData` when a refresh occurs.
 *
 * Throws if the token is expired and either refresh fails or no refresh
 * token is available — caller must surface a re-auth prompt to the client.
 */
export async function ensureValidGoogleToken(
  env: Env,
  userData: StoredUserData
): Promise<string> {
  if (userData.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return userData.accessToken;
  }

  if (!userData.refreshToken) {
    throw new Error(
      'Google authentication expired and no refresh token available. Please re-authenticate via /auth endpoint.'
    );
  }

  try {
    const googleAuth = new GoogleAuth(env);
    const newTokens = await googleAuth.refreshAccessToken(userData.refreshToken);

    userData.accessToken = newTokens.access_token;
    userData.expiresAt = Date.now() + newTokens.expires_in * 1000;
    await updateStoredUserData(env, userData);

    return newTokens.access_token;
  } catch (error) {
    console.error('[worker] Token refresh failed:', error);
    throw new Error(
      'Google authentication expired and refresh failed. Please re-authenticate via /auth endpoint.'
    );
  }
}

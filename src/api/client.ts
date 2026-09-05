import { DEFAULT_TIMEOUT_MS, MAX_DOCUMENT_SIZE } from './constants.js';

/**
 * Low-level HTTP client for Google APIs.
 * Handles bearer auth, timeouts, and uniform error mapping.
 */
export class ApiClient {
  constructor(private readonly accessToken: string) {}

  /**
   * Raw bearer token, exposed for endpoints that need to bypass JSON parsing
   * (e.g. text exports).
   */
  get token(): string {
    return this.accessToken;
  }

  /**
   * Make a JSON request with timeout. Returns parsed JSON typed as `T`.
   * Callers pass the expected response shape — there is no runtime validation
   * beyond Google's own API contract.
   */
  async request<T>(
    url: string,
    options: RequestInit = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          ...options.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        // Don't expose detailed API errors to users.
        const safeError =
          response.status >= 500
            ? 'Google API temporarily unavailable'
            : `Request failed with status ${response.status}`;
        throw new Error(safeError);
      }

      // Guard against absurdly large payloads before parsing.
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_DOCUMENT_SIZE) {
        throw new Error('Document too large to process');
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }
}

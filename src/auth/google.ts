import { Env } from '../types';
import { TokenManager } from './token-manager';

export class GoogleAuth {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private tokenManager: TokenManager;

  constructor(env: Env) {
    this.clientId = env.GOOGLE_CLIENT_ID;
    this.clientSecret = env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = env.GOOGLE_REDIRECT_URI;
    this.tokenManager = new TokenManager(env.TOKEN_STORE);
  }

  /**
   * Generate OAuth2 authorization URL
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive.readonly',
        'openid',
        'profile',
        'email'
      ].join(' '),
      access_type: 'offline',
      prompt: 'consent'
    });

    if (state) {
      params.append('state', state);
    }

    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }

    return response.json();
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<{
    access_token: string;
    expires_in: number;
    token_type: string;
  }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token refresh failed: ${error}`);
    }

    return response.json();
  }

  /**
   * Get user info from Google
   */
  async getUserInfo(accessToken: string): Promise<{
    id: string;
    email: string;
    name: string;
    picture?: string;
  }> {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    return response.json();
  }

  /**
   * Complete OAuth flow: exchange code and store tokens
   */
  async completeOAuthFlow(code: string, userId: string): Promise<{
    access_token: string;
    refresh_token?: string;
    user_info: any;
  }> {
    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(code);
    
    // Get user info
    const userInfo = await this.getUserInfo(tokens.access_token);
    
    // Store tokens securely
    await this.tokenManager.storeTokens(userId, tokens);
    
    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      user_info: userInfo,
    };
  }

  /**
   * Method to get valid access token (auto-refresh if needed)
   */
  async getValidAccessToken(userId: string): Promise<string | null> {
    const tokens = await this.tokenManager.getTokens(userId);
    if (!tokens) return null;

    if (await this.tokenManager.needsRefresh(userId)) {
      if (tokens.refresh_token) {
        const newTokens = await this.refreshAccessToken(tokens.refresh_token);
        await this.tokenManager.updateTokens(userId, newTokens);
        return newTokens.access_token;
      } else {
        // No refresh token, user needs to re-authenticate
        await this.tokenManager.deleteTokens(userId);
        return null;
      }
    }

    return tokens.access_token;
  }

  /**
   * Check if user is authenticated
   */
  async isAuthenticated(userId: string): Promise<boolean> {
    const tokens = await this.tokenManager.getTokens(userId);
    return tokens !== null;
  }

  /**
   * Logout user (delete tokens)
   */
  async logout(userId: string): Promise<void> {
    await this.tokenManager.deleteTokens(userId);
  }

  private validateAccessToken(token: string): boolean {
    return Boolean(token && token.length > 10 && token.startsWith('ya29.'));
  }
}

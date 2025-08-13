export class TokenManager {
    private tokenStore: KVNamespace;
  
    constructor(tokenStore: KVNamespace) {
      this.tokenStore = tokenStore;
    }
  
    // Store tokens with expiration
    async storeTokens(userId: string, tokens: {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    }): Promise<void> {
      const tokenData = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in * 1000),
      };
  
      // Store with TTL (Time To Live)
      await this.tokenStore.put(
        `tokens:${userId}`, 
        JSON.stringify(tokenData),
        {
          expirationTtl: tokens.expires_in + 300 // Add 5 minutes buffer
        }
      );
    }
  
    // Retrieve tokens
    async getTokens(userId: string): Promise<{
      access_token: string;
      refresh_token?: string;
      expires_at: number;
    } | null> {
      const stored = await this.tokenStore.get(`tokens:${userId}`);
      if (!stored) return null;
  
      return JSON.parse(stored);
    }
  
    // Check if token needs refresh
    async needsRefresh(userId: string): Promise<boolean> {
      const tokens = await this.getTokens(userId);
      if (!tokens) return true;
  
      // Refresh if expires within 5 minutes
      return tokens.expires_at < (Date.now() + 300000);
    }
  
      // Delete tokens (logout)
  async deleteTokens(userId: string): Promise<void> {
    await this.tokenStore.delete(`tokens:${userId}`);
  }

  // Get token expiration time
  async getTokenExpiration(userId: string): Promise<number | null> {
    const tokens = await this.getTokens(userId);
    return tokens ? tokens.expires_at : null;
  }

  // Check if tokens exist for user
  async hasTokens(userId: string): Promise<boolean> {
    const tokens = await this.getTokens(userId);
    return tokens !== null;
  }

  // Get time until token expires (in seconds)
  async getTimeUntilExpiration(userId: string): Promise<number | null> {
    const tokens = await this.getTokens(userId);
    if (!tokens) return null;
    
    const now = Date.now();
    const expiresAt = tokens.expires_at;
    return Math.max(0, Math.floor((expiresAt - now) / 1000));
  }

  // Update tokens (for refresh scenarios)
  async updateTokens(userId: string, newTokens: {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  }): Promise<void> {
    // Get existing tokens to preserve refresh_token if not provided
    const existingTokens = await this.getTokens(userId);
    
    const tokenData = {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token || existingTokens?.refresh_token,
      expires_at: Date.now() + (newTokens.expires_in * 1000),
    };

    await this.tokenStore.put(
      `tokens:${userId}`, 
      JSON.stringify(tokenData),
      {
        expirationTtl: newTokens.expires_in + 300 // Add 5 minutes buffer
      }
    );
  }
}



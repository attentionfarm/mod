declare module 'claude-code' {
  interface PluginState {
    attentionfarm: {
      ticker: { enabled: boolean; paused: boolean };
      tickerOffset: number;
      // No email, code, token or challenge id: only a masked address such as y•••@example.com.
      // flash: the few seconds after a login when the band says "you're in." / "welcome back."
      account: { status: 'unknown' | 'out' | 'in' | 'offline' | 'unsupported'; masked?: string; flash?: 'new' | 'back' };
      // Free backup in this session. No key: only what the band shows.
      backup: { status: 'off' | 'offer' | 'switching' | 'on'; reason?: 'limit' | 'manual'; label?: string; remaining?: number; note?: string };
      // Free tokens this Claude Code session used through attentionfarm, from each request's usage.
      backupTokens: { input: number; output: number; cacheRead: number; cacheCreation: number; steps: number };
      // Which half of the exchange switch sits up: 0 claude, 1 free af tokens; between while it moves.
      switchPose: number;
      // The free models attentionfarm offers (free OpenRouter ids and short labels), and the one picked in the band.
      freeModels: { id: string; label: string }[];
      // '' when nothing is picked: the server tries its roster in its own order.
      freeModel: string;
      // Watch ad, get tokens, as the server last said: whether earning exists, whether an ad can be watched now,
      // why not (a limit's message), tokens earned and not yet spent, an ad's worth and ads left today.
      earn: { enabled?: boolean; available: boolean; message?: string; earned: number; tokensPerAd?: number; adsLeft?: number };
      // A newer mod: none, available (the band's update button), or updating (through the plugin reload).
      modUpdate: { status: 'none' | 'available' | 'updating' };
      pane: {
        site: 'none' | 'pane' | 'band';
        step: 'email' | 'code' | 'account' | 'delete';
        intent: 'login' | 'signup';
        busy: boolean;
        canResend: boolean;
        sentTo?: string;
        error?: string;
        note?: string;
      };
    };
  }
}

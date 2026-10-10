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

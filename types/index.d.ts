declare module 'claude-code' {
  interface PluginState {
    attentionfarm: {
      ticker: { enabled: boolean; paused: boolean };
      tickerOffset: number;
      // No email, code, token or challenge id: only a masked address such as n•••@gmail.com.
      // flash: the few seconds after a login when the band says "you're in." / "welcome back."
      account: { status: 'unknown' | 'out' | 'in' | 'offline' | 'unsupported'; masked?: string; flash?: 'new' | 'back' };
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

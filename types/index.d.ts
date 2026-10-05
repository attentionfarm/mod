declare module 'claude-code' {
  interface PluginState {
    attentionfarm: {
      ticker: { enabled: boolean; paused: boolean };
      tickerOffset: number;
    };
  }
}

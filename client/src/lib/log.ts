type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const defaultLevel: Level = (import.meta.env.PROD ? 'warn' : 'info');

function getLevel(): Level {
  const fromEnv = (import.meta.env.VITE_LOG_LEVEL as Level) || undefined;
  const fromWindow = (globalThis as any).__LOG_LEVEL__ as Level | undefined;
  return (fromWindow || fromEnv || defaultLevel) as Level;
}

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };
function shouldLog(level: Level) {
  return order[level] >= order[getLevel()];
}

function prefix(level: string, msg: any, source?: string) {
  const time = new Date().toISOString();
  return `[${time}]${source ? ` [${source}]` : ''} ${msg}`;
}

export const log = {
  debug: (msg: any, source?: string) => shouldLog('debug') && console.debug(prefix('debug', msg, source)),
  info: (msg: any, source?: string) => shouldLog('info') && console.info(prefix('info', msg, source)),
  warn: (msg: any, source?: string) => shouldLog('warn') && console.warn(prefix('warn', msg, source)),
  error: (msg: any, source?: string) => shouldLog('error') && console.error(prefix('error', msg, source)),
};


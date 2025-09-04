type Level = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const envLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'warn' : 'info')).toLowerCase() as Level;

const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 50 };

function shouldLog(level: Level) {
  return order[level] >= order[envLevel];
}

function format(level: string, msg: any, source?: string) {
  const time = new Date().toISOString();
  return `[${time}]${source ? ` [${source}]` : ''} ${level.toUpperCase()}: ${msg}`;
}

export const logger = {
  debug: (msg: any, source?: string) => {
    if (shouldLog('debug')) console.debug(format('debug', msg, source));
  },
  info: (msg: any, source?: string) => {
    if (shouldLog('info')) console.info(format('info', msg, source));
  },
  warn: (msg: any, source?: string) => {
    if (shouldLog('warn')) console.warn(format('warn', msg, source));
  },
  error: (msg: any, source?: string) => {
    if (shouldLog('error')) console.error(format('error', msg, source));
  }
};


import { recordDebugEvent } from './debug/debug-hub.ts';

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

const capture = (level: Exclude<Level, 'silent'>, msg: any, source?: string) => {
  try {
    recordDebugEvent({
      level,
      source: source ?? 'server',
      message: msg,
    });
  } catch {
    // Debug capture should never crash logging; swallow errors defensively.
  }
};

export const logger = {
  debug: (msg: any, source?: string) => {
    capture('debug', msg, source);
    if (shouldLog('debug')) console.debug(format('debug', msg, source));
  },
  info: (msg: any, source?: string) => {
    capture('info', msg, source);
    if (shouldLog('info')) console.info(format('info', msg, source));
  },
  warn: (msg: any, source?: string) => {
    capture('warn', msg, source);
    if (shouldLog('warn')) console.warn(format('warn', msg, source));
  },
  error: (msg: any, source?: string) => {
    capture('error', msg, source);
    if (shouldLog('error')) console.error(format('error', msg, source));
  }
};

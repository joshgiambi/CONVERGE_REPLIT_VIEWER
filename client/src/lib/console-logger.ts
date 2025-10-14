/**
 * Console Logger - Captures console logs and sends to debug hub
 *
 * This intercepts console methods and forwards important logs to the backend
 * debug hub so we can view them later.
 */

const isDev = import.meta.env.DEV;

interface LogEntry {
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: number;
  data?: any;
}

const logQueue: LogEntry[] = [];
let flushTimer: number | null = null;

async function flushLogs() {
  if (logQueue.length === 0) return;

  const logsToSend = [...logQueue];
  logQueue.length = 0;

  try {
    await fetch('/api/debug-hub/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: 'info',
        component: 'console',
        message: 'Browser console logs',
        metadata: { logs: logsToSend },
      }),
    });
  } catch (err) {
    // Silently fail - don't want logging to break the app
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    flushLogs();
  }, 2000); // Batch logs every 2 seconds
}

function captureLog(level: LogEntry['level'], args: any[]) {
  const message = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');

  // Only capture logs with emojis (our debug logs)
  if (!/[\u{1F300}-\u{1F9FF}]/u.test(message)) return;

  logQueue.push({
    level,
    message,
    timestamp: Date.now(),
    data: args.length > 1 ? args.slice(1) : undefined,
  });

  scheduleFlush();
}

// Store original console methods
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

export function initConsoleLogger() {
  if (!isDev) return; // Only in development

  console.log('🎤 Console logger initialized - capturing logs with emojis');

  // Intercept console.log
  console.log = (...args: any[]) => {
    captureLog('info', args);
    originalConsole.log(...args);
  };

  // Intercept console.warn
  console.warn = (...args: any[]) => {
    captureLog('warn', args);
    originalConsole.warn(...args);
  };

  // Intercept console.error
  console.error = (...args: any[]) => {
    captureLog('error', args);
    originalConsole.error(...args);
  };

  // Intercept console.debug
  console.debug = (...args: any[]) => {
    captureLog('debug', args);
    originalConsole.debug(...args);
  };

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushLogs();
  });
}

export function getRecentLogs(): LogEntry[] {
  return [...logQueue];
}
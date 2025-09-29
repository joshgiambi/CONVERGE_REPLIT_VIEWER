export type DebugEventLevel = 'debug' | 'info' | 'warn' | 'error';

export interface DebugEvent {
  id: number;
  timestamp: string;
  level: DebugEventLevel;
  source: string;
  message: string;
  context?: Record<string, unknown>;
}

const MAX_EVENTS = 500;
const eventBuffer: DebugEvent[] = [];
let nextId = 1;

const toMessage = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const tidyContext = (value?: Record<string, unknown>): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined);
  if (!keys.length) return undefined;
  return keys.reduce<Record<string, unknown>>((acc, key) => {
    acc[key] = value[key];
    return acc;
  }, {});
};

export function recordDebugEvent(event: {
  level: DebugEventLevel;
  source: string;
  message: unknown;
  context?: Record<string, unknown>;
}): DebugEvent {
  const entry: DebugEvent = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    level: event.level,
    source: event.source,
    message: toMessage(event.message),
    context: tidyContext(event.context),
  };

  eventBuffer.push(entry);
  if (eventBuffer.length > MAX_EVENTS) {
    eventBuffer.splice(0, eventBuffer.length - MAX_EVENTS);
  }
  return entry;
}

export interface DebugEventQuery {
  source?: string | string[];
  levels?: DebugEventLevel | DebugEventLevel[];
  sinceId?: number;
  limit?: number;
}

export function getDebugEvents(query: DebugEventQuery = {}): DebugEvent[] {
  const sources = Array.isArray(query.source)
    ? query.source.filter(Boolean)
    : query.source
    ? [query.source]
    : null;
  const levels = Array.isArray(query.levels)
    ? query.levels
    : query.levels
    ? [query.levels]
    : null;
  const sinceId = typeof query.sinceId === 'number' && Number.isFinite(query.sinceId)
    ? query.sinceId
    : null;
  const limit = typeof query.limit === 'number' && query.limit > 0 ? Math.floor(query.limit) : null;

  let events = eventBuffer.slice();
  if (sinceId !== null) {
    events = events.filter((event) => event.id > sinceId);
  }
  if (sources && sources.length) {
    const sourceSet = new Set(sources);
    events = events.filter((event) => sourceSet.has(event.source));
  }
  if (levels && levels.length) {
    const levelSet = new Set(levels);
    events = events.filter((event) => levelSet.has(event.level));
  }

  if (limit !== null && events.length > limit) {
    events = events.slice(events.length - limit);
  }

  return events;
}

export function getLatestEventId(): number {
  return eventBuffer.length ? eventBuffer[eventBuffer.length - 1].id : nextId - 1;
}

export function clearDebugEvents(): void {
  eventBuffer.length = 0;
  nextId = 1;
}

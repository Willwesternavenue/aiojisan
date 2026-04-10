// Lightweight structured logger for server-side use
// Outputs JSON lines in production, readable format in dev

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: string;
  data?: unknown;
  timestamp: string;
}

const isDev = process.env.NODE_ENV !== 'production';

function log(level: LogLevel, message: string, context?: string, data?: unknown) {
  const entry: LogEntry = {
    level,
    message,
    context,
    data,
    timestamp: new Date().toISOString(),
  };

  if (isDev) {
    const prefix = context ? `[${context}]` : '';
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    const levelColors: Record<LogLevel, string> = {
      debug: '\x1b[37m',
      info:  '\x1b[36m',
      warn:  '\x1b[33m',
      error: '\x1b[31m',
    };
    console.log(`${levelColors[level]}${entry.timestamp} ${level.toUpperCase()} ${prefix} ${message}${dataStr}\x1b[0m`);
  } else {
    // JSON lines for log aggregation in production
    console.log(JSON.stringify(entry));
  }
}

export function createLogger(context: string) {
  return {
    debug: (message: string, data?: unknown) => log('debug', message, context, data),
    info:  (message: string, data?: unknown) => log('info',  message, context, data),
    warn:  (message: string, data?: unknown) => log('warn',  message, context, data),
    error: (message: string, data?: unknown) => log('error', message, context, data),
  };
}

// Default logger for quick use
export const logger = createLogger('app');

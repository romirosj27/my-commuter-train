import { pino, type Logger } from 'pino';

export type { Logger };

export function createLogger(level = process.env.LOG_LEVEL ?? 'info', name = 'worker'): Logger {
  const pretty = process.env.NODE_ENV === 'development' && process.stdout.isTTY;
  return pino({
    name,
    level,
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}

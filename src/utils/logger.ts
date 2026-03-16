import chalk from 'chalk';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      process.stderr.write(chalk.gray(`[DEBUG] ${msg}\n`));
      if (args.length) console.error(...args);
    }
  },

  info(msg: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      process.stderr.write(chalk.blue(`[INFO] ${msg}\n`));
      if (args.length) console.error(...args);
    }
  },

  warn(msg: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      process.stderr.write(chalk.yellow(`[WARN] ${msg}\n`));
      if (args.length) console.error(...args);
    }
  },

  error(msg: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      process.stderr.write(chalk.red(`[ERROR] ${msg}\n`));
      if (args.length) console.error(...args);
    }
  },

  success(msg: string): void {
    process.stderr.write(chalk.green(`✓ ${msg}\n`));
  },
};

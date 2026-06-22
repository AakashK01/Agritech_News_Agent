/**
 * Structured logger — writes JSON lines to stdout/stderr.
 * No external dependencies. Drop-in for any console-based logging.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function log(level: LogLevel, msg: string, meta?: object): void {
    const entry = {
        level,
        msg,
        ts: new Date().toISOString(),
        ...(meta ?? {}),
    };
    if (level === 'error' || level === 'warn') {
        console.error(JSON.stringify(entry));
    } else {
        console.log(JSON.stringify(entry));
    }
}

export const logger = {
    debug: (msg: string, meta?: object) => log('debug', msg, meta),
    info:  (msg: string, meta?: object) => log('info',  msg, meta),
    warn:  (msg: string, meta?: object) => log('warn',  msg, meta),
    error: (msg: string, meta?: object) => log('error', msg, meta),
};

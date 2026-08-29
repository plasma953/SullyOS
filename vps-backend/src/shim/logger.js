/**
 * 轻量分级日志。Cloudflare Worker 里用 console.log/warn/error，
 * 这里统一加时间戳与级别前缀，LOG_LEVEL 可控（debug|info|warn|error）。
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(scope = 'sullyos') {
  const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

  function fmt(level, args) {
    const ts = new Date().toISOString();
    return [`[${ts}] [${scope}] [${level}]`, ...args];
  }

  return {
    debug: (...a) => { if (LEVELS.debug >= threshold) console.log(...fmt('debug', a)); },
    info: (...a) => { if (LEVELS.info >= threshold) console.log(...fmt('info', a)); },
    warn: (...a) => { if (LEVELS.warn >= threshold) console.warn(...fmt('warn', a)); },
    error: (...a) => { if (LEVELS.error >= threshold) console.error(...fmt('error', a)); },
  };
}

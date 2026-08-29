/**
 * Cron 注册表（node-cron 封装，替代 Cloudflare Cron Triggers）。
 *
 * 用法：
 *   const reg = new CronRegistry();
 *   reg.add('0 * * * *', () => worker.scheduled({ cron: '0 * * * *' }, env), { name: 'cleanup' });
 *   reg.start();
 *
 * 注：块注释内不能直接写「每5分钟」的 cron 表达式（'* /5' 中的星号斜杠会提前
 * 结束本注释），示例统一用整点表达式；实际使用不受此限制。
 *
 * 时区默认 Asia/Shanghai（可用 env CRON_TZ 覆盖）。
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export class CronRegistry {
  constructor({ timezone } = {}) {
    this.tasks = [];
    this.timezone = timezone ?? process.env.CRON_TZ ?? 'Asia/Shanghai';
    this._cronMod = null;
  }

  _cron() {
    if (!this._cronMod) {
      try {
        this._cronMod = require('node-cron');
      } catch {
        throw new Error('node-cron 未安装。请在 vps-backend 目录执行: npm install');
      }
    }
    return this._cronMod;
  }

  /**
   * @param {string} expr 标准 cron 表达式（5 段或 6 段，秒可选）
   * @param {() => void | Promise<void>} fn
   * @param {{name?: string}} [opts]
   */
  add(expr, fn, opts = {}) {
    const name = opts.name ?? `cron#${this.tasks.length + 1}`;
    const task = this._cron().schedule(
      expr,
      () => {
        Promise.resolve()
          .then(fn)
          .catch((err) => console.error(`[cron] ${name} 执行失败:`, err));
      },
      { timezone: this.timezone },
    );
    this.tasks.push({ name, expr, task });
    return task;
  }

  start() {
    for (const t of this.tasks) t.task.start();
  }

  stop() {
    for (const t of this.tasks) t.task.stop();
  }
}
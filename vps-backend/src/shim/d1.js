/**
 * D1 → better-sqlite3 适配器（Cloudflare Env 兼容层）。
 *
 * 只实现 Worker 实际用到的 D1 API 面：
 *   prepare().bind(...).run()/first()/all()/raw()
 *   batch(statements)
 *   exec(sql)
 *
 * better-sqlite3 是可选依赖（optionalDependencies）：未安装且确有服务需要 DB 时
 * 会抛出带安装指引的错误。instant-push 默认 multipart 模式不需要 DB。
 */

import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @returns {any} better-sqlite3 模块或抛出安装指引错误 */
function loadBetterSqlite3() {
  try {
    return require('better-sqlite3');
  } catch {
    throw new Error(
      'better-sqlite3 未安装（D1 兼容层必需）。请在 vps-backend 目录执行: npm install better-sqlite3',
    );
  }
}

/**
 * @param {string} dbPath sqlite 文件路径
 * @returns D1 风格适配器
 */
export function createD1Adapter(dbPath) {
  const Database = loadBetterSqlite3();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  const adapter = {
    /** @param {string} query */
    prepare(query) {
      const stmt = db.prepare(query);
      let bound = [];

      return {
        /** @param {...unknown} args */
        bind(...args) {
          bound = args;
          return this;
        },
        /** D1Result */
        async run() {
          const info = stmt.run(...bound);
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid),
              duration: 0,
              size_after: 0,
              rows_read: 0,
              rows_written: info.changes,
            },
          };
        },
        /** 单行或 null */
        async first() {
          const row = stmt.get(...bound);
          return row === undefined ? null : row;
        },
        /** 所有行（对象数组） */
        async all() {
          return stmt.all(...bound);
        },
        /** 原始行（数组的数组） */
        async raw() {
          return stmt.raw().all(...bound);
        },
      };
    },

    /** @param {Array<{run():Promise<unknown>}>} statements */
    async batch(statements) {
      const runAll = db.transaction((list) => list.map((s) => s.run()));
      const results = runAll(statements);
      // 事务内 run() 返回 Promise，这里等待 settle 后再返回
      return Promise.all(results);
    },

    /** @param {string} sql */
    async exec(sql) {
      db.exec(sql);
      return { success: true, meta: {} };
    },

    close() {
      db.close();
    },
  };

  return adapter;
}
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
 * D1 → better-sqlite3 的占位符规范化：
 *   CF D1 使用 ?1 ?2 ... 编号占位符 + 位置绑定；
 *   better-sqlite3 对 ?N 编号占位符的位置绑定不兼容（报 Too many parameter values），
 *   因此把编号占位符统一替换为匿名 ?（保持出现顺序），绑定参数原样直通。
 *   跳过单引号字符串字面量（含 '' 转义），避免误伤 SQL 里的 ?N 字面量。
 * @param {string} sql
 */
function normalizeParams(sql) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inStr && sql[i + 1] === "'") { out += "''"; i++; continue; } // '' 转义
      inStr = !inStr;
      out += ch;
      continue;
    }
    if (!inStr && ch === '?' && /\d/.test(sql[i + 1] ?? '')) {
      let j = i + 1;
      while (/\d/.test(sql[j] ?? '')) j++;
      out += '?';
      i = j - 1;
      continue;
    }
    out += ch;
  }
  return out;
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
      const stmt = db.prepare(normalizeParams(query));
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
        /** 所有行（D1Result：{ results: 对象数组 }，与 Cloudflare D1 契约一致） */
        async all() {
          return { results: stmt.all(...bound) };
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
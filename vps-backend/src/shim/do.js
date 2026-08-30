/**
 * DurableObject 兼容垫片（Cloudflare Env 兼容层）。
 *
 * DO 在 CF 里是跨隔离区 RPC 的独享状态对象；Node 单进程里直接用
 * 「命名空间 + 类注册表 + SQLite KV 存储」等价实现：
 *  - state.storage.get/put/delete/list/alarm → SQLite 表 do_kv / do_alarms
 *  - stub.fetch() → 实例化注册的 DO 类并直连调用其 fetch
 *
 * 目前 SullyOS 已确认要移植的 worker（instant-push/amsg/proactive-push）
 * 以 D1 + Cron 为主；本垫片供 amsg 等若引用 DO 时启用。
 */

const ensureTablesSql = `
CREATE TABLE IF NOT EXISTS do_kv (
  ns   TEXT NOT NULL,
  id   TEXT NOT NULL,
  key  TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (ns, id, key)
);
CREATE TABLE IF NOT EXISTS do_alarms (
  ns   TEXT NOT NULL,
  id   TEXT NOT NULL,
  due  INTEGER NOT NULL,
  PRIMARY KEY (ns, id)
);`;

export class DurableObjectShim {
  /** @param {{ns:string, id:string, d1:any, className:string}} init */
  constructor({ ns, id, d1, className }) {
    this.ns = ns;
    this.id = id;
    this.d1 = d1;
    this.className = className;
    this._pending = [];
  }

  get storage() {
    const { ns, id, d1 } = this;
    return {
      async get(key) {
        const row = await d1
          .prepare('SELECT value FROM do_kv WHERE ns = ? AND id = ? AND key = ?')
          .bind(ns, id, key)
          .first();
        return row ? JSON.parse(row.value) : undefined;
      },
      async put(key, value) {
        await d1
          .prepare('INSERT INTO do_kv (ns, id, key, value) VALUES (?, ?, ?, ?) ON CONFLICT(ns, id, key) DO UPDATE SET value = excluded.value')
          .bind(ns, id, key, JSON.stringify(value))
          .run();
      },
      async delete(key) {
        await d1.prepare('DELETE FROM do_kv WHERE ns = ? AND id = ? AND key = ?').bind(ns, id, key).run();
        return true;
      },
      async list() {
        // all() 现按 CF D1 契约返回 { results }（见 shim/d1.js），这里同步取 .results。
        const { results: rows } = await d1.prepare('SELECT key FROM do_kv WHERE ns = ? AND id = ?').bind(ns, id).all();
        return new Map((rows ?? []).map((r) => [r.key, r.key]));
      },
      async getAlarm() {
        const row = await d1.prepare('SELECT due FROM do_alarms WHERE ns = ? AND id = ?').bind(ns, id).first();
        return row ? Number(row.due) : null;
      },
      async setAlarm(due) {
        if (due == null) {
          await d1.prepare('DELETE FROM do_alarms WHERE ns = ? AND id = ?').bind(ns, id).run();
        } else {
          await d1
            .prepare('INSERT INTO do_alarms (ns, id, due) VALUES (?, ?, ?) ON CONFLICT(ns, id) DO UPDATE SET due = excluded.due')
            .bind(ns, id, Number(due))
            .run();
        }
      },
      async deleteAlarm() {
        await d1.prepare('DELETE FROM do_alarms WHERE ns = ? AND id = ?').bind(ns, id).run();
        return true;
      },
    };
  }

  waitUntil(promise) {
    this._pending.push(Promise.resolve(promise).catch((e) => console.error('[do-shim] waitUntil 失败:', e)));
  }

  async drain() {
    await Promise.allSettled(this._pending);
  }
}

/**
 * 创建一个 DO 命名空间绑定（等价 env.MY_DO）。
 * @param {{namespace:string, d1:any, classes:Record<string, new (state:any, env:any)=>any>, env:any}} cfg
 */
export function createDurableObjectNamespace({ namespace, d1, classes = {}, env = {} }) {
  let ready = null;

  function ensureTables() {
    if (!ready) ready = d1.exec(ensureTablesSql);
    return ready;
  }

  return {
    idFromName(name) {
      return { name, toString: () => String(name) };
    },
    get(id) {
      const idName = typeof id === 'string' ? id : id.name;
      return {
        async fetch(request) {
          await ensureTables();
          // 从请求 URL 或约定头解析目标类名；默认取注册表里唯一的类
          const classNames = Object.keys(classes);
          const target = classNames.length === 1 ? classNames[0] : classNames[0];
          const Cls = classes[target];
          if (!Cls) throw new Error(`[do-shim] 命名空间 ${namespace} 未注册 DO 类`);
          const state = new DurableObjectShim({ ns: namespace, id: idName, d1, className: target });
          const instance = new Cls(state, env);
          const res = await instance.fetch(request);
          await state.drain();
          return res;
        },
        async alarm() {
          await ensureTables();
          const Cls = Object.values(classes)[0];
          if (Cls && typeof Cls.prototype.alarm === 'function') {
            const state = new DurableObjectShim({ ns: namespace, id: idName, d1, className: 'default' });
            await new Cls(state, env).alarm();
          }
        },
      };
    },
  };
}
/**
 * ExecutionContext（ctx）兼容垫片。
 * Cloudflare 的 ctx = { waitUntil, passThroughOnException, props }。
 * Node 里 waitUntil 的 promise 会被跟踪并在连接处理结束后 settle，
 * 但不阻塞响应；失败只记录日志（等效 CF 的"尽力而为后台任务"）。
 */

export function createCfContext({ onError } = {}) {
  /** @type {Promise<unknown>[]} */
  let pending = [];

  const ctx = {
    /**
     * @param {Promise<unknown> | unknown} promise
     */
    waitUntil(promise) {
      const p = Promise.resolve(promise);
      pending.push(
        p.catch((err) => {
          const handler = onError ?? ((e) => console.error('[cf-context] waitUntil 任务失败:', e));
          handler(err);
        }),
      );
      return p;
    },
    passThroughOnException() {
      // Node 无异常透传概念：未捕获异常已由全局 handler 兜底，这里空实现即可。
    },
    props: {},
  };

  return {
    ctx,
    /** 等待所有 waitUntil 任务结束（服务关闭/测试用）。 */
    drain() {
      return Promise.allSettled(pending);
    },
  };
}

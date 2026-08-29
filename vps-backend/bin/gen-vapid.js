#!/usr/bin/env node
/**
 * VAPID 密钥对生成器（Web Push）。
 *
 * 输出与 Cloudflare `crypto.subtle` 生成的 P-256 密钥完全等价：
 *   VAPID_PUBLIC_KEY  65 字节未压缩点（04||x||y）的 base64url（无填充）
 *   VAPID_PRIVATE_KEY 私钥 d 的 base64url（无填充）
 *
 * 用法：
 *   node bin/gen-vapid.js
 *   node bin/gen-vapid.js --email push@example.com
 * 写入 /opt/sullyos/.env 后重启 instant-push 即可。
 */

const email = (() => {
  const i = process.argv.indexOf('--email');
  return i >= 0 && process.argv[i + 1] ? process.argv[++i] : 'amsg@sullyos.local';
})();

function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

async function main() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );

  const pub = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);

  const x = Buffer.from(pub.x, 'base64url');
  const y = Buffer.from(pub.y, 'base64url');
  const raw = Buffer.concat([Buffer.from([4]), x, y]); // 未压缩点

  console.log('# 追加到 /opt/sullyos/.env（勿入库）');
  console.log(`VAPID_PUBLIC_KEY=${b64u(raw)}`);
  console.log(`VAPID_PRIVATE_KEY=${b64u(Buffer.from(priv.d, 'base64url'))}`);
  console.log(`VAPID_EMAIL=${email}`);
}

main().catch((err) => {
  console.error('[gen-vapid] 生成失败:', err);
  process.exit(1);
});
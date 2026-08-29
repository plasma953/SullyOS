#!/usr/bin/env node
/**
 * sqlite 一致性快照：<src> → <dst>
 * 用法: node vacuum-snapshot.cjs <src.sqlite> <dst.sqlite>
 * 使用 vps-backend/node_modules 里的 better-sqlite3（与 D1 适配器同源），
 * 通过 backup API 生成 VACUUM 语义的在线一致性副本。
 */
'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
const requireFromBackend = createRequire(path.join(__dirname, '..', '..', 'package.json'));
const Database = requireFromBackend('better-sqlite3');

const [src, dst] = process.argv.slice(2);
if (!src || !dst) {
  console.error('用法: vacuum-snapshot.cjs <src.sqlite> <dst.sqlite>');
  process.exit(2);
}
const db = new Database(src, { readonly: true, fileMustExist: true });
try {
  db.backup(dst);
  console.log(`snapshot ok: ${src} -> ${dst}`);
} finally {
  db.close();
}
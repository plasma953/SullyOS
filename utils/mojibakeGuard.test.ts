/**
 * 乱码护栏：全仓源码不得出现 U+FFFD（U+FFFD = 编辑时多字节字符被按字节截断的残骸）。
 *
 * 背景：2026-09 前后多个 Windows 本地 AI 会话写文件时截断 UTF-8，累计在 8 个文件
 * 留下 203 处替换符（修于 fix(utf8) 提交）。本测试防复发：任何新编辑再产生 U+FFFD
 * 都会在这里红掉，而不是等到有人发现按钮文案里冒出半个残字。
 *
 * 只扫文本类扩展名；worker.bundle.js 是构建产物、node_modules 是第三方，跳过。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', '.worktrees', 'test-results']);
const SKIP_FILES = new Set(['worker.bundle.js']);
const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.html',
  '.sh', '.yml', '.yaml', '.toml', '.svg', '.txt', '.webmanifest', '.xml',
]);
const MAX_BYTES = 3_000_000;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) yield* walk(p);
    } else {
      yield p;
    }
  }
}

describe('utf-8 截断护栏（U+FFFD 禁入源码）', () => {
  it('全仓文本源码里没有 U+FFFD 替换符', () => {
    const bad: { file: string; count: number }[] = [];
    for (const p of walk(ROOT)) {
      if (SKIP_FILES.has(p.split(sep).pop() || '')) continue;
      const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
      if (!TEXT_EXTS.has(ext)) continue;
      let raw: Buffer;
      try {
        if (statSync(p).size > MAX_BYTES) continue;
        raw = readFileSync(p);
      } catch {
        continue;
      }
      const n = countSeq(raw);
      if (n > 0) bad.push({ file: relative(ROOT, p), count: n });
    }
    expect(
      bad,
      `发现 U+FFFD（UTF-8 截断乱码）。请修复或还原对应行，别让坏编码再进仓库：\n${bad
        .map((b) => `  ${b.file} ×${b.count}`)
        .join('\n')}`,
    ).toEqual([]);
  });
});

function countSeq(raw: Buffer): number {
  let n = 0;
  for (let i = 0; i <= raw.length - 3; i += 1) {
    if (raw[i] === 0xef && raw[i + 1] === 0xbf && raw[i + 2] === 0xbd) n += 1;
  }
  return n;
}

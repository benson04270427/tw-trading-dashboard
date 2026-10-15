// 說明文件：每項功能都有一份說明並列在索引中、相對連結都存在、主說明連到功能索引與版本紀錄（規則見 AGENTS.md）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const features = path.join(repo, 'docs', 'features');
const read = p => fs.readFileSync(p, 'utf8');
// Markdown 中的相對連結（排除網址與錨點），回傳 [原文, 絕對路徑]
const links = file => [...read(file).matchAll(/\]\(([^)\s]+)\)/g)].map(m => m[1]).filter(h => !/^(https?:|mailto:|#)/.test(h))
  .map(h => [h, path.resolve(path.dirname(file), decodeURIComponent(h.split('#')[0]))]);

test('every feature guide is listed in the index, and every index link exists', () => {
  const docs = fs.readdirSync(features).filter(f => f.endsWith('.md') && f !== 'README.md');
  assert.ok(docs.length >= 15);
  const listed = new Set(links(path.join(features, 'README.md')).map(([, p]) => p));
  assert.deepEqual(docs.filter(f => !listed.has(path.join(features, f))), [], 'feature guides missing from docs/features/README.md');
  for (const [href, p] of links(path.join(features, 'README.md'))) assert.ok(fs.existsSync(p), `broken link in index: ${href}`);
});

test('feature guides start with a title and their relative links exist', () => {
  for (const f of fs.readdirSync(features).filter(f => f.endsWith('.md'))) {
    const file = path.join(features, f);
    assert.match(read(file), /^# \S/, `${f} needs a title`);
    for (const [href, p] of links(file)) assert.ok(fs.existsSync(p), `broken link in ${f}: ${href}`);
  }
});

test('README links to the feature index and the changelog; changelog links resolve', () => {
  const readme = path.join(repo, 'README.zh-TW.md'), changelog = path.join(repo, 'docs', 'CHANGELOG.zh-TW.md');
  const targets = links(readme).map(([, p]) => p);
  assert.ok(targets.includes(path.join(features, 'README.md')));
  assert.ok(targets.includes(changelog));
  for (const file of [readme, changelog]) for (const [href, p] of links(file)) assert.ok(fs.existsSync(p), `broken link in ${path.basename(file)}: ${href}`);
  assert.match(read(changelog), /^## \d{4}-\d{2}-\d{2} · /m, 'changelog entries start with a date');
});

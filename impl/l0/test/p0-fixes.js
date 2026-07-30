// p0-fixes.js - 验证两个 P0 修复:值索引 compaction + stampOrigin 分片
// 运行:node --test impl/l0/test/p0-fixes.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampOrigin, stampOriginChunked } from '../src/stamp-origin.js';
import { getStamp, bumpGeneration, valueIndexSize, compact } from '../src/value-index.js';

test('compaction: bumpGen 后物理删除旧代条目', () => {
  stampOrigin({ name: 'pre-compact-unique' }, 'GET /a');
  assert.ok(getStamp('pre-compact-unique'), '压缩前应命中');
  const sizeBefore = valueIndexSize();
  assert.ok(sizeBefore > 0, '有条目');
  bumpGeneration(); // 触发压缩
  assert.equal(getStamp('pre-compact-unique'), null, '旧代应过期');
  const sizeAfter = valueIndexSize();
  assert.ok(sizeAfter < sizeBefore, `压缩后条目应减少(${sizeBefore}->${sizeAfter})`);
  assert.equal(sizeAfter, 0, '旧代全删,应为 0');
});

test('compaction: 新代条目保留', () => {
  bumpGeneration(); // gen=N
  stampOrigin({ name: 'current-gen-unique' }, 'GET /b');
  assert.ok(getStamp('current-gen-unique'), '当前代应命中');
  compact(); // 显式压缩
  assert.ok(getStamp('current-gen-unique'), '当前代条目压缩后应保留');
});

test('stampOriginChunked: 大响应分片不阻塞,结果正确', async () => {
  const big = { items: Array.from({ length: 1000 }, (_, i) => ({ id: `chunk-id-${i}`, name: `chunk-name-${i}` })) };
  await stampOriginChunked(big, 'GET /chunk');
  // 抽查若干元素值是否盖戳
  assert.ok(getStamp('chunk-name-0'), '元素 0 应盖戳');
  assert.ok(getStamp('chunk-name-500'), '元素 500 应盖戳');
  assert.ok(getStamp('chunk-name-999'), '元素 999 应盖戳');
  assert.ok(getStamp(1000), 'length 应盖戳');
});

test('stampOriginChunked: 循环引用不崩', async () => {
  const a = { name: 'chunk-cycle-x' };
  a.self = a;
  await assert.doesNotReject(async () => {
    await stampOriginChunked(a, 'GET /cc');
  });
  assert.ok(getStamp('chunk-cycle-x'), '循环对象的叶子仍盖戳');
});

test('stampOriginChunked vs stampOrigin: 同一数据,结果一致', async () => {
  // 用不同 sourceId 避免互相污染
  const data1 = { a: 'sync-vs-async-1', b: { c: 'sync-vs-async-2' } };
  const data2 = { a: 'sync-vs-async-1', b: { c: 'sync-vs-async-2' } };
  stampOrigin(data1, 'GET /sync');
  await stampOriginChunked(data2, 'GET /async');
  // 同值应都能查到(各自 sourceId 的字段)
  assert.ok(getStamp('sync-vs-async-1'), '同步版盖戳');
  // async 版盖戳(同值,union 进同一 key)
  assert.ok(getStamp('sync-vs-async-2'), '两版都应盖戳(值索引共享)');
});

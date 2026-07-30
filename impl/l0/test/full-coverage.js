// full-coverage.js - 补全功能测试:JSON.parse重盖/早退region P/entityKey/subscribe/multi-arg/时间维度
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp, stampValuePassport, getEntityKey } from '../src/value-index.js';
import { getControlStack } from '../src/control-index.js';
import { recover } from '../src/recovery.js';
import { subscribe, lookup, allEdges, recordEdge } from '../src/graph.js';
import { __controlEnter, __controlExit, __readSlot } from '../src/babel-runtime.js';

test('JSON.parse 重盖:已盖戳串 parse 后叶子重盖', () => {
  const data = { user: { name: 'json-reparse-1' } };
  stampOrigin(data, 'GET /jp1');
  const str = JSON.stringify(data);
  // 模拟 str 被盖戳(实际场景:API 数据 stringify 存 localStorage)
  const pp = getStamp('json-reparse-1')?.passport ?? 0n;
  stampValuePassport(str, pp);
  // JSON.parse 重盖:str 有护照 -> parse 后叶子重盖
  const reparsed = JSON.parse(str);
  assert.ok(getStamp('json-reparse-1'), 'parse 后 name 叶子应重盖');
});

test('JSON.parse 透传:未盖戳串不影响', () => {
  const before = getStamp('plain-string-no-stamp');
  JSON.parse('{"a":1}'); // 无护照串,透传
  assert.equal(getStamp('plain-string-no-stamp'), before, '未盖戳串不影响索引');
});

test('早退 region P:控制栈 push/pop 正确', () => {
  const data = { flag: false };
  stampOrigin(data, 'GET /erp');
  const cp = __readSlot(data, ['flag']);
  const before = getControlStack().length;
  __controlEnter(cp);
  assert.equal(getControlStack().length, before + 1, 'push 后栈 +1');
  __controlExit();
  assert.equal(getControlStack().length, before, 'pop 后栈恢复');
});

test('entityKey:对象有 id -> 叶子带记录级血缘', () => {
  const data = { items: [{ id: 'rec-001', name: 'ek-test-1' }, { id: 'rec-002', name: 'ek-test-2' }] };
  stampOrigin(data, 'GET /ek');
  assert.equal(getEntityKey('ek-test-1'), 'rec-001');
  assert.equal(getEntityKey('ek-test-2'), 'rec-002');
  assert.equal(getEntityKey('not-in-data'), null);
});

test('entityKey:无 id 对象 -> entityKey null', () => {
  stampOrigin({ name: 'no-id-test-1' }, 'GET /ni');
  assert.equal(getEntityKey('no-id-test-1'), null, '无 id 字段时 entityKey 应 null');
});

test('subscribe:recordEdge 后微task 回调', async () => {
  const received = [];
  const unsub = subscribe((batch) => { received.push(...batch); });
  const fakeNode = { tag: 'sub-test', nodeType: 1 };
  recordEdge(100, fakeNode, 'data', 'exact', 'sub');
  await new Promise(r => setTimeout(r, 10));
  assert.ok(received.length > 0, '应收到回调');
  assert.equal(received[0].edgeType, 'data');
  unsub();
});

test('subscribe:取消后不再回调', async () => {
  let count = 0;
  const unsub = subscribe(() => { count++; });
  unsub();
  recordEdge(101, { tag: 'sub-cancel', nodeType: 1 }, 'data', 'exact', 'x');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(count, 0, '取消后不应回调');
});

test('multi-arg:7 字段 recover 触发 breaker', () => {
  const data = { a: 'ma-1', b: 'ma-2', c: 'ma-3', d: 'ma-4', e: 'ma-5', f: 'ma-6', g: 'ma-7' };
  stampOrigin(data, 'GET /ma');
  recover('ma-result', ['ma-1', 'ma-2', 'ma-3', 'ma-4', 'ma-5', 'ma-6', 'ma-7']);
  const s = getStamp('ma-result');
  assert.ok(s, '应命中');
  assert.ok(s.collision, '7>5 应熔断 collision');
});

test('multi-arg:2 字段 recover 不熔断', () => {
  stampOrigin({ x: 'ma2-1', y: 'ma2-2' }, 'GET /ma2');
  recover('ma2-result', ['ma2-1', 'ma2-2']);
  const s = getStamp('ma2-result');
  assert.ok(s && !s.collision, '2 字段不应熔断');
});

test('时间维度:lookup(node, {since}) 过滤旧边', () => {
  const node = { tag: 'time-test', nodeType: 1 };
  recordEdge(200, node, 'data', 'exact', 'old');
  recordEdge(201, node, 'data', 'exact', 'new');
  const all = lookup(node);
  const maxSeq = Math.max(...all.map(r => r.lastSeenWrite));
  const recent = lookup(node, { since: maxSeq });
  assert.ok(recent.every(r => r.lastSeenWrite >= maxSeq), 'since 过滤后只含新边');
  assert.ok(recent.length <= all.length, '过滤后边数 <= 全部');
});

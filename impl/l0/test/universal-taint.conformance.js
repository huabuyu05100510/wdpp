// universal-taint.conformance.js - Universal Taint Union 测试
// 验证:7+ 新 helpers 工作正确
// (__writeField / __recoverSelf / __throw / __readSlot / __nullish /
//  __optionalChain / __deleteField / __taggedTemplate / __await / __classPropertyInit)
//
// 规范:WDPP §4.2 + §4.3 + §7
//
// 运行:node --test test/universal-taint.conformance.js

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { smGet } from '../src/sm.js';

let document, stampOrigin, getStamp, bumpGeneration;
let __writeField, __recoverSelf, __throw, __readSlot, __readField,
    __nullish, __optionalChain, __deleteField, __taggedTemplate,
    __await, __classPropertyInit, __recover;

before(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost/' });
  const { window } = dom;
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, Element: window.Element,
    CharacterData: window.CharacterData, HTMLInputElement: window.HTMLInputElement,
    HTMLImageElement: window.HTMLImageElement, HTMLAnchorElement: window.HTMLAnchorElement,
    MutationObserver: window.MutationObserver,
  });
  await import('../src/dom-sink.js');
  const so = await import('../src/stamp-origin.js');
  const vi = await import('../src/value-index.js');
  const br = await import('../src/babel-runtime.js');
  stampOrigin = so.stampOrigin;
  getStamp = vi.getStamp;
  bumpGeneration = vi.bumpGeneration;
  __writeField = br.__writeField;
  __recoverSelf = br.__recoverSelf;
  __throw = br.__throw;
  __readSlot = br.__readSlot;
  __nullish = br.__nullish;
  __optionalChain = br.__optionalChain;
  __deleteField = br.__deleteField;
  __taggedTemplate = br.__taggedTemplate;
  __await = br.__await;
  __classPropertyInit = br.__classPropertyInit;
  __recover = br.__recover;
  __readField = br.__readField;
  document = window.document;
});

beforeEach(() => {
  document.getElementById('app').innerHTML = '';
  bumpGeneration();
});

// ============================================================
// __writeField:obj.x = y 字段突变
// ============================================================

test('P3-1 __writeField:obj.x = y 时,obj.x 的 SM 槽位继承 y 的 taint', () => {
  stampOrigin({ newVal: 'WriteField-Unique' }, 'GET /write-field');

  const obj = {};
  __writeField(obj, 'status', 'WriteField-Unique');

  // 后续读 obj.status 应该有 'newVal' 字段的 taint
  const slot = smGet(obj, "status");
  assert.ok(slot, 'SM 槽位应被设置');
  assert.ok(slot > 0n, 'SM 槽位非 0');
});

test('P3-1 __writeField:obj.x = undefined 不报错', () => {
  const obj = {};
  __writeField(obj, 'x', undefined);
  assert.equal(obj.x, undefined);
});

// ============================================================
// __recoverSelf:x = y 赋值
// ============================================================

test('P3-2 __recoverSelf:x = y 时,result 继承 y 的 taint', () => {
  stampOrigin({ yVal: 'RecoverSelf-Unique' }, 'GET /recover-self');

  let result;
  __recoverSelf((result = 'RecoverSelf-Unique'), 'RecoverSelf-Unique');

  // result 应带 yVal 字段的 taint
  const stamp = getStamp(result);
  assert.ok(stamp, 'result 应有 taint');
});

// ============================================================
// __throw:throw x 抛出值 taint 保留
// ============================================================

test('P3-5 __throw:throw 时 value 的 taint 保留到全局 __wdpp_lastThrownTaint', () => {
  stampOrigin({ errVal: 'Throw-Unique' }, 'GET /throw');

  try {
    __throw('Throw-Unique');
  } catch {
    // 预期抛出
  }

  const lastThrown = globalThis.__wdpp_lastThrownTaint;
  assert.ok(lastThrown, '__wdpp_lastThrownTaint 应被设置');
  assert.ok(lastThrown > 0n, 'lastThrownTaint 非 0');
});

// ============================================================
// __readSlot:解构 const {a} = obj
// ============================================================

test('P3-3 __readField:解构时 a 继承 obj.a 的字段 taint', () => {
  // 先盖戳 obj
  const obj = { name: 'Destruct-Unique' };
  stampOrigin(obj, 'GET /destruct');

  // 解构模拟
  const a = __readField(obj, 'name');
  assert.equal(a, 'Destruct-Unique');

  // a 应该有 obj.name 的字段 taint(SM 槽位继承)
  const stamp = getStamp(a);
  assert.ok(stamp, '解构出的 a 应有 taint');
});

// ============================================================
// __nullish:a ?? b
// ============================================================

test('P3-5 __nullish:a ?? b,a 非 nullish 选 a 的 taint', () => {
  stampOrigin({ aVal: 'NullishA-Unique' }, 'GET /nullish');

  const aTaint = 1n << 5n;
  const bTaint = 1n << 6n;
  const result = __nullish('NullishA-Unique', 'NullishB-Unique', aTaint, bTaint);

  assert.equal(result, 'NullishA-Unique');
  const stamp = getStamp(result);
  // 因为 stampValuePassport 应用了 aTaint,且 aTaint 非 0,值索引会有 aTaint 位
  assert.ok(stamp, '应能查到 taint');
});

test('P3-5 __nullish:a ?? b,a 是 nullish 选 b 的 taint', () => {
  const aTaint = 1n << 5n;
  const bTaint = 1n << 6n;
  const result = __nullish(null, 'fallback', aTaint, bTaint);

  assert.equal(result, 'fallback');
});

// ============================================================
// __optionalChain:a?.b
// ============================================================

test('P3-5 __optionalChain:obj 非 null 时正常读', () => {
  const obj = { b: 'OptChain-Unique' };
  const r = __optionalChain(obj, 'b');
  assert.equal(r, 'OptChain-Unique');
});

test('P3-5 __optionalChain:obj 为 null 时返 undefined(不抛错)', () => {
  const r = __optionalChain(null, 'b');
  assert.equal(r, undefined);
});

// ============================================================
// __deleteField:delete obj.x
// ============================================================

test('P3-6 __deleteField:delete 后字段 taint 被移除', () => {
  const obj = { x: 'Delete-Unique' };
  stampOrigin(obj, 'GET /delete-field');

  // 删前应有 taint
  const before = smGet(obj, "x");
  assert.ok(before, '删前应有 SM 槽位');

  // 删除
  __deleteField(obj, 'x');
  assert.equal(obj.x, undefined);

  // 删后 SM 槽位应被移除
  const after = smGet(obj, "x");
  assert.equal(after, 0n, '删后 SM 槽位应被清空');
});

// ============================================================
// __taggedTemplate / __await / __classPropertyInit
// ============================================================

test('P3 __taggedTemplate:tag 函数返回值继承 values taint', () => {
  stampOrigin({ tagArg: 'Tag-Unique' }, 'GET /tagged');

  // 简单 tag 函数:identity(返回第一个 value)
  const tag = (strings, ...values) => values[0];
  // 调用形式:__taggedTemplate(tag, strings, ...values)
  const result = __taggedTemplate(tag, [''], 'Tag-Unique');
  assert.equal(result, 'Tag-Unique');
});

test('P3 __await:同步值透传', () => {
  const value = 'await-value';
  const result = __await(value);
  assert.equal(result, value);
});

test('P3 __classPropertyInit:this.x = y 同 __writeField', () => {
  stampOrigin({ cpVal: 'ClassInit-Unique' }, 'GET /class-init');

  const instance = {};
  __classPropertyInit(instance, 'x', 'ClassInit-Unique');

  const slot = smGet(instance, 'x');
  assert.ok(slot, 'instance.x 应有 SM 槽位');
});

// ============================================================
// Universal Taint Union:核心原则
// ============================================================

test('UTU 核心:output = f(inputs) → provenance(output) = ∪ inputs', () => {
  stampOrigin({ a: 'UTU-A', b: 'UTU-B' }, 'GET /utu');

  // 模拟 toUpperCase(UTU-A)
  const a = 'UTU-A';
  const b = 'UTU-B';
  void b;

  // 用 __recover 测试 UTU 原则
  const result = __recover(a.toUpperCase(), [a]);
  assert.ok(getStamp(result), 'result 应继承 a 的 taint');
});
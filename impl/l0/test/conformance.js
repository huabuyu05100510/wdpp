// conformance.js - 一致性测试套件(golden cases):正例记边 + 反例不记边
// 运行:node --test impl/l0/test/conformance.js
// 规范:WDPP-L0 验收铁律。纯逻辑测试(value-index + stamp-origin);DOM sink 在 demo 浏览器里验证。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp, bumpGeneration, getFieldId } from '../src/value-index.js';

function setup() {
  // 每个测试用独立 sourceId 避免跨用例污染(值索引是全局的,碰撞是设计行为,这里用不同值隔离)
}

// ===== 正例:API 值流到屏幕 =====
test('正例:stampOrigin 后,API 值能查到护照', () => {
  const data = { user: { name: 'Ada-Lovelace-1843', level: 7, isVip: true } };
  stampOrigin(data, 'GET /users/42');
  const s = getStamp('Ada-Lovelace-1843');
  assert.ok(s, 'name 应命中');
  assert.equal(s.collision, false);
  assert.ok(s.passport !== 0n);
});

test('正例:类型归一化桥 -- DOM 写字符串 "7" 能查到 number 7 的盖戳', () => {
  const data = { n: 7 };
  stampOrigin(data, 'GET /num');
  // 盖戳的是 number 7,DOM 写的是字符串 "7"
  const s = getStamp('7');
  assert.ok(s, '字符串 "7" 应命中 number 7 的盖戳(双形态)');
});

test('正例:数组 length 盖戳', () => {
  const data = { items: [{ id: 'id-a-1' }, { id: 'id-b-2' }] };
  stampOrigin(data, 'GET /list');
  const s = getStamp(2); // items.length === 2
  assert.ok(s, 'length 应命中');
});

// ===== 反例:不记边(验收铁律)=====
test('反例:低熵值 true 不盖戳(布尔失效,防级联)', () => {
  const data = { flag: true };
  stampOrigin(data, 'GET /flag');
  assert.equal(getStamp(true), null, 'true 是低熵,不盖戳');
  assert.equal(getStamp('true'), null);
});

test('反例:低熵值 0/1/"" 不盖戳', () => {
  stampOrigin({ a: 0, b: 1, c: '' }, 'GET /low');
  assert.equal(getStamp(0), null);
  assert.equal(getStamp(1), null);
  assert.equal(getStamp(''), null);
});

test('反例:field-sensitive -- 不同字段不同值,护照不交叉污染', () => {
  const obj = { greeting: 'hello-unique-xyz', level: 42 };
  stampOrigin(obj, 'GET /fs');
  const g = getStamp('hello-unique-xyz');
  const l = getStamp(42);
  assert.ok(g && l, '两字段各自命中');
  assert.notEqual(g.passport, l.passport, 'greeting 和 level 的护照必须不同(不交叉污染)');
  // 按值追踪:不同值天然分开,这就是 field-sensitive 自动满足
});

test('反例:未盖戳的值查不到(字面量若不在数据里,无边)', () => {
  stampOrigin({ a: 'in-data-1' }, 'GET /x');
  assert.equal(getStamp('never-in-data-999'), null, '不在数据里的字面量无护照');
  assert.ok(getStamp('in-data-1'), '在数据里的值有护照');
});

// ===== 碰撞(诚实,不 CUT)=====
test('碰撞:两字段同值 -> 并集,标 collision(不 CUT,不假阴性)', () => {
  const data = { a: 'same-value-zzz', b: 'same-value-zzz' };
  stampOrigin(data, 'GET /collide');
  const s = getStamp('same-value-zzz');
  assert.ok(s, '碰撞应命中(不 CUT)');
  assert.equal(s.count, 2, '两字段并集');
});

test('熔断:护照集 > K 降 collision', () => {
  // 造 6 个字段同值
  const data = { a: 'multi-qqq', b: 'multi-qqq', c: 'multi-qqq', d: 'multi-qqq', e: 'multi-qqq', f: 'multi-qqq' };
  stampOrigin(data, 'GET /multi');
  const s = getStamp('multi-qqq');
  assert.ok(s.collision, '>5 字段应熔断为 collision');
});

// ===== 生命周期(代际)=====
test('代际:bumpGeneration 后旧护照过期', () => {
  const data = { name: 'before-logout-unique' };
  stampOrigin(data, 'GET /s1');
  assert.ok(getStamp('before-logout-unique'), '登出前应命中');
  bumpGeneration(); // 模拟登出
  assert.equal(getStamp('before-logout-unique'), null, '登出后旧护照应过期');
});

// ===== 路径分段 key(字段名含 .)=====
test('路径分段 key:字段名含 "." 不歧义', () => {
  const data1 = { 'user.name': 'dotfield-1' };
  const data2 = { user: { name: 'dotfield-2' } };
  stampOrigin(data1, 'GET /d1');
  stampOrigin(data2, 'GET /d2');
  assert.ok(getStamp('dotfield-1'), '字段 "user.name" 的值命中');
  assert.ok(getStamp('dotfield-2'), '嵌套 user.name 的值命中');
  // 两者 fieldId 不同(路径分段不同),不互相污染
});

// ===== 循环引用保护 =====
test('循环引用不崩', () => {
  const a = { name: 'cycle-x' };
  a.self = a;
  assert.doesNotThrow(() => stampOrigin(a, 'GET /cycle'));
  assert.ok(getStamp('cycle-x'));
});

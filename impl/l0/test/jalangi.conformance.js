// jalangi.conformance.js — 断路一致性测试(可执行规范)
// 原则:护照值附着(WeakMap/值索引)。每个原语过一道,问"结果是否还携带护照"——
//   携带=通路;丢失=断路(必须插桩)。纯拷贝(赋值/解构/参数)护照随值,理论上不断路。
// 运行:node --test impl/l0/test/jalangi.conformance.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp, bumpGeneration } from '../src/value-index.js';
import { controlGet } from '../src/control-index.js';
import {
  __recover, __controlAnd, __controlOr, __controlTernary, __controlReturn,
  __readSlot, __controlEnter, __controlExit, __readProp, __fieldGet, __aggr,
} from '../src/babel-runtime.js';

const HELPERS = {
  __recover, __controlAnd, __controlOr, __controlTernary, __controlReturn,
  __readSlot, __controlEnter, __controlExit, __readProp, __fieldGet, __aggr,
};

// 把 body 包进 IIFE 再变换执行(body 内可 return),helpers 与 vars 注入闭包
function runBody(body, vars = {}, async = false) {
  const wrap = async ? `(async function(){ ${body} })` : `(function(){ ${body} })`;
  const out = transformSync(wrap, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const names = [...Object.keys(HELPERS), ...Object.keys(vars)];
  const vals = [...Object.values(HELPERS), ...Object.values(vars)];
  const factory = new Function(...names, `"use strict"; return ${out.code};`);
  return factory(...vals)();
}
const evalExpr = (expr, vars) => runBody(`return (${expr});`, vars);
const fresh = () => bumpGeneration();

// ============ A. 变换:新值必须带照 ============
test('二元拼接 a+b:结果带照', () => {
  fresh();
  const d = { a: 'x', b: 'y' }; stampOrigin(d, 'GET /r');
  assert.equal(evalExpr('d.a + d.b', { d }), 'xy');
  assert.ok(getStamp('xy'), '拼接结果 xy 应带照');
});

test('成员读静态键 obj.name:结果带照(数据边)', () => {
  fresh();
  const d = { name: 'Grace' }; stampOrigin(d, 'GET /u');
  assert.equal(evalExpr('d.name', { d }), 'Grace');
  assert.ok(getStamp('Grace'), '读 d.name 后 Grace 应带照(L1 不包成员读 → 当前断)');
});

test('计算成员 lookup[code]:结果有控制边', () => {
  fresh();
  const code = 2; stampOrigin({ v: code }, 'GET /s');
  const lookup = { 0: 'off', 1: 'run', 2: 'on' };
  assert.equal(evalExpr('lookup[code]', { lookup, code }), 'on');
  assert.ok(controlGet('on').length, 'lookup[code] 应给 "on" 一条来自 code 的控制边(当前断)');
});

test('纯方法 s.toUpperCase():结果带照', () => {
  fresh();
  const d = { s: 'abc' }; stampOrigin(d, 'GET /s');
  assert.equal(evalExpr('d.s.toUpperCase()', { d }), 'ABC');
  assert.ok(getStamp('ABC'), '纯方法结果应带照');
});

test('一般调用 f(x):结果带照', () => {
  fresh();
  const d = { v: 'in' }; stampOrigin(d, 'GET /r');
  const f = (x) => x + '_out';
  assert.equal(evalExpr('f(d.v)', { f, d }), 'in_out');
  assert.ok(getStamp('in_out'), '一般调用结果应带入参护照(当前断)');
});

// ============ A. lvalue 正确性(不能改坏代码)============
test('++obj.n 不崩且自增 + 带照', () => {
  fresh();
  const d = { n: 5 }; stampOrigin(d, 'GET /n');
  evalExpr('++d.n', { d });
  assert.equal(d.n, 6, '++ 必须真的自增');
  assert.ok(getStamp(6), '++ 后 6 应带照');
});

test('方法 this 绑定不丢 + 带照', () => {
  fresh();
  const d = { v: 10, get() { return this.v + 1; } }; stampOrigin(d, 'GET /m');
  assert.equal(evalExpr('d.get()', { d }), 11);
  assert.ok(getStamp(11), '方法结果应带照');
});

// ============ B. 控制 ============
test('三元 c?a:b:a 受 c 控制', () => {
  fresh();
  const d = { c: 2 }; stampOrigin(d, 'GET /c');
  assert.equal(evalExpr('d.c ? "YES" : "NO"', { d }), 'YES');
  assert.ok(controlGet('YES').length, '"YES" 应有来自 c 的控制边');
});

// ============ A. 聚合 ============
test('数组字面量 [a,b]:元素带照', () => {
  fresh();
  const d = { a: 'x', b: 'y' }; stampOrigin(d, 'GET /r');
  assert.deepEqual(evalExpr('[d.a, d.b]', { d }), ['x', 'y']);
  assert.ok(getStamp('x') && getStamp('y'), '数组元素应各自带照');
});

// ============ C. 边界 ============
test('解构 const {n}=obj:n 带照(纯拷贝,护照随值)', () => {
  fresh();
  const d = { n: 'v' }; stampOrigin(d, 'GET /d');
  assert.equal(runBody('const { n } = d; return n;', { d }), 'v');
  assert.ok(getStamp('v'), '解构是纯拷贝,n 应带照(无需插桩)');
});

test('await:护照跨 microtask 存活', async () => {
  fresh();
  const d = { v: 'p' }; stampOrigin(d, 'GET /a');
  const r = await runBody('return await Promise.resolve(d.v);', { d }, true);
  assert.equal(r, 'p');
  assert.ok(getStamp('p'), 'await 后值应仍带照(当前断)');
});

// ============ D. 元语 ============
test('class getter:g 结果带照', () => {
  fresh();
  const d = { raw: 'g' }; stampOrigin(d, 'GET /g');
  const r = runBody('class C { constructor(o){ this.o = o; } get val(){ return this.o.raw; } } return new C(d).val;', { d });
  assert.equal(r, 'g');
  assert.ok(getStamp('g'), 'getter 读 raw 后应带照(当前断)');
});

test('optional chain a?.b:结果带照', () => {
  fresh();
  const d = { o: { b: 'oc' } }; stampOrigin(d, 'GET /oc');
  assert.equal(evalExpr('d.o?.b', { d }), 'oc');
  assert.ok(getStamp('oc'), 'optional chain 结果应带照(当前断)');
});

// ============ G. 新容器断路(字面量/工厂):容器自身要带照,否则作 receiver 时断 ============
test('新数组字面量:容器自身带照(作 receiver 不再断路)', () => {
  fresh();
  const d = { a: 'x', b: 'y' }; stampOrigin(d, 'GET /r');
  const r = evalExpr('JSON.stringify([d.a, d.b])', { d });
  assert.equal(r, '["x","y"]');
  assert.ok(getStamp(r), '新数组经 __aggr 盖戳 → stringify 结果带照(过近似 receiver 通)');
});

test('工厂返回新对象:容器自身带照', () => {
  fresh();
  const d = { a: 'x' }; stampOrigin(d, 'GET /r');
  const factory = (src) => ({ wrapped: src.a });
  const obj = evalExpr('factory(d)', { factory, d });
  assert.ok(getStamp(obj), '工厂返回的新对象应自身带照(recover-object 盖输入并集)');
});

// ============ B 续:一元 / 复合赋值 / new ============
test('一元 -n:结果带照', () => {
  fresh();
  const d = { n: 7 }; stampOrigin(d, 'GET /n');
  assert.equal(evalExpr('-d.n', { d }), -7);
  assert.ok(getStamp(-7), '-n 产新值应带照');
});

test('复合赋值 obj.n += 1:不崩 + 新值带照', () => {
  fresh();
  const d = { n: 5 }; stampOrigin(d, 'GET /n');
  evalExpr('d.n += 2', { d });
  assert.equal(d.n, 7, '+= 必须真的累加');
  assert.ok(getStamp(7), '+= 后新值应带照(逆运算还原旧值)');
});

test('new C(arg):实例带照(recover-object)', () => {
  fresh();
  const d = { a: 'x' }; stampOrigin(d, 'GET /r');
  function C(v) { this.v = v; }
  const inst = evalExpr('new C(d.a)', { C, d });
  assert.ok(getStamp(inst), 'new C(arg) 实例应带输入并集照');
});

// l1.conformance.js - L1 一致性测试:变换恢复 + 控制边
// 运行:node --test impl/l0/test/l1.conformance.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp } from '../src/value-index.js';
import { controlGet } from '../src/control-index.js';
import { __recover, __controlAnd, __controlOr, __controlTernary, __readSlot } from '../src/babel-runtime.js';

// 变换 + 在 helper 作用域内执行
function run(src, ctx = {}) {
  const out = transformSync(src, {
    filename: 'x.js',
    babelrc: false,
    configFile: false,
    plugins: [plugin],
  });
  const fn = new Function(
    '__recover', '__controlAnd', '__controlOr', '__controlTernary', '__readSlot',
    'ctx',
    `${out.code}; return ctx;`
  );
  return fn(__recover, __controlAnd, __controlOr, __controlTernary, __readSlot, ctx);
}

// ===== 变换恢复:纯方法 =====
test('L1 变换恢复:toUpperCase 出边(L0 查不到,L1 能)', () => {
  const data = { user: { name: 'Grace-Hopper-1900' } };
  stampOrigin(data, 'GET /u');
  assert.equal(getStamp('GRACE-HOPPER-1900'), null, 'L0 查不到变换值');
  const out = transformSync(`data.user.name.toUpperCase()`, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const fn = new Function('__recover', 'data', `return ${out.code};`);
  const r = fn(__recover, data);
  assert.equal(r, 'GRACE-HOPPER-1900');
  const s = getStamp('GRACE-HOPPER-1900');
  assert.ok(s, 'L1 变换后大写值应命中 name 的护照');
});

test('L1 变换恢复:toFixed(价格上屏)', () => {
  const data = { price: 99 };
  stampOrigin(data, 'GET /p');
  // 99 是数字,盖戳了(非低熵)
  const out = transformSync(`data.price.toFixed(2)`, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const fn = new Function('__recover', 'data', `return ${out.code};`);
  const r = fn(__recover, data);
  assert.equal(r, '99.00');
  const s = getStamp('99.00');
  assert.ok(s, 'toFixed 结果应命中 price 的护照');
});

// ===== 控制边:&& 内联 =====
test('L1 控制边:isVip && "VIP" -> "VIP" 受 isVip 控制', () => {
  const data = { user: { isVip: true } };
  stampOrigin(data, 'GET /v');
  // isVip = true 是低熵不盖戳,但 SM 有字段级护照(条件侧车)
  const out = transformSync(`data.user.isVip && 'VIP'`, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const fn = new Function('__controlAnd', '__readSlot', 'data', `return ${out.code};`);
  const r = fn(__controlAnd, __readSlot, data);
  assert.equal(r, 'VIP');
  const ctrls = controlGet('VIP');
  assert.ok(ctrls.length, '"VIP" 应有控制边(来自 isVip)');
});

test('L1 控制边:三元 loading ? "加载中" : "内容"', () => {
  const data = { loading: false };
  stampOrigin(data, 'GET /l');
  const out = transformSync(`data.loading ? '加载中' : '内容'`, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const fn = new Function('__controlTernary', '__readSlot', 'data', `return ${out.code};`);
  const r = fn(__controlTernary, __readSlot, data);
  assert.equal(r, '内容');
  const ctrls = controlGet('内容');
  assert.ok(ctrls.length, '"内容" 应有 loading 控制边');
});

// ===== 语义保持(条件假时不走右支)=====
test('L1 语义:cond 假时 && 返回 cond,不执行右支', () => {
  const data = { flag: false };
  stampOrigin(data, 'GET /f');
  let rightCalled = false;
  const out = transformSync(`data.flag && sideEffect()`, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const fn = new Function('__controlAnd', '__readSlot', 'data', 'sideEffect', `return ${out.code};`);
  const r = fn(__controlAnd, __readSlot, data, () => { rightCalled = true; return 'RIGHT'; });
  assert.equal(r, false, 'cond 假应返回 cond(false)');
  assert.equal(rightCalled, false, '右支不应执行(语义保持)');
});

// ===== 跨组件边界降级(诚实:controlIndex 只闭环内联)=====
test('L1 边界:跨组件 controlIndex 不闭环(诚实降级 L2)', () => {
  // {show && <Panel/>} 求值点只创建 element,Panel 函数体未执行,其值无法登记
  // 本测试验证:对组件调用,controlIndex 登记不到组件内部的值
  const data = { show: true };
  stampOrigin(data, 'GET /s');
  const out = transformSync(`data.show && Panel()`, {
    filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin],
  });
  const fn = new Function('__controlAnd', '__readSlot', 'data', 'Panel', `return ${out.code};`);
  // Panel 返回一个对象(模拟 element);controlAdd 对对象不登记(L1 限制)
  const r = fn(__controlAnd, __readSlot, data, () => ({ type: 'div', children: '内部值' }));
  assert.equal(typeof r, 'object', '返回 element');
  // 对象返回值不进 controlIndex(跨组件降级)
  assert.equal(controlGet('[object Object]').length, 0, '对象返回值不登记(跨组件边界,属 L2)');
});

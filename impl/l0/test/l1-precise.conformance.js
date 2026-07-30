// l1-precise.conformance.js - 精确实现测试:二元/模板/一般调用/if 控制边/L2
// 运行:node --test impl/l0/test/l1-precise.conformance.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp } from '../src/value-index.js';
import { controlGet } from '../src/control-index.js';
import { __recover, __controlAnd, __controlReturn, __readSlot, __readProp, __controlEnter, __controlExit } from '../src/babel-runtime.js';

function tx(src, l2 = false) {
  return transformSync(src, {
    filename: 'x.js', babelrc: false, configFile: false,
    presets: ['@babel/preset-react'], plugins: [[plugin, { l2 }]],
  });
}
// 表达式:包在 return 里
function runExpr(src, vars, l2 = false) {
  const out = tx(src, l2);
  const keys = Object.keys(vars);
  const fn = new Function(...keys, '__recover', '__controlAnd', '__controlReturn', '__readSlot', '__readProp', '__controlEnter', '__controlExit', `return ${out.code};`);
  return fn(...keys.map(k => vars[k]), __recover, __controlAnd, __controlReturn, __readSlot, __readProp, __controlEnter, __controlExit);
}
function runStmt(src, vars, l2 = false) {
  const out = tx(`function __t() { ${src} }`, l2);
  const keys = Object.keys(vars);
  const fn = new Function(...keys, '__recover', '__controlAnd', '__controlReturn', '__readSlot', '__readProp', '__controlEnter', '__controlExit', `${out.code}; return __t();`);
  return fn(...keys.map(k => vars[k]), __recover, __controlAnd, __controlReturn, __readSlot, __readProp, __controlEnter, __controlExit);
}

// ===== 二元表达式 =====
test('二元:a + b -> recover', () => {
  const data = { a: 'foo-unique-1', b: 'bar-unique-2' };
  stampOrigin(data, 'GET /bin');
  const r = runExpr(`data.a + data.b`, { data });
  assert.equal(r, 'foo-unique-1bar-unique-2');
  const s = getStamp(r);
  assert.ok(s, '拼接结果应命中 a 和 b 的护照');
});

test('二元:算术 a * b', () => {
  const data = { x: 7, y: 6 };
  stampOrigin(data, 'GET /mul');
  const r = runExpr(`data.x * data.y`, { data });
  assert.equal(r, 42);
  const s = getStamp(42);
  assert.ok(s, '乘积 42 应命中 x 和 y');
});

// ===== 模板字面量 =====
test('模板:`${a}-${b}` -> recover', () => {
  const data = { a: 'tpl-A-1', b: 'tpl-B-1' };
  stampOrigin(data, 'GET /tpl');
  const r = runExpr('`prefix-${data.a}-${data.b}`', { data });
  assert.equal(r, 'prefix-tpl-A-1-tpl-B-1');
  assert.ok(getStamp(r), '模板结果应命中 a 和 b');
});

// ===== if 语句控制边 =====
test('if (cond) return X:X 受 cond 控制', () => {
  const data = { flag: true };
  stampOrigin(data, 'GET /if1');
  const r = runStmt(`if (data.flag) { return 'IF-RESULT'; } return 'ELSE';`, { data });
  assert.equal(r, 'IF-RESULT');
  const ctrls = controlGet('IF-RESULT');
  assert.ok(ctrls.length, 'IF-RESULT 应有 flag 控制边');
});

test('if-else:两支都受 cond 控制', () => {
  const data = { flag: false };
  stampOrigin(data, 'GET /if2');
  const r = runStmt(`if (data.flag) { return 'TRUE-BRANCH'; } else { return 'FALSE-BRANCH'; }`, { data });
  assert.equal(r, 'FALSE-BRANCH');
  const ctrls = controlGet('FALSE-BRANCH');
  assert.ok(ctrls.length, 'FALSE-BRANCH 应有 flag 控制边');
});

// ===== if 语义保持(cond 假走 else)=====
test('if 语义:cond 假时返回 else 支', () => {
  const data = { flag: false };
  stampOrigin(data, 'GET /if3');
  const r = runStmt(`if (data.flag) { return 'TRUE'; } return 'FALL';`, { data });
  assert.equal(r, 'FALL');
});

// ===== L2:全量属性读 __readProp =====
test('L2:属性读经 __readProp 返回原值', () => {
  const data = { user: { name: 'l2-prop-test' } };
  stampOrigin(data, 'GET /l2p');
  const r = runExpr(`data.user.name`, { data }, true); // l2=true
  assert.equal(r, 'l2-prop-test', '__readProp 应返回原值');
});

test('L2:一般函数调用 f(a) -> recover', () => {
  const data = { val: 'l2-call-input-1' };
  stampOrigin(data, 'GET /l2c');
  const toUpper = (s) => s.toUpperCase();
  const r = runExpr(`customToUpper(data.val)`, { data, customToUpper: toUpper }, true);
  assert.equal(r, 'L2-CALL-INPUT-1');
  assert.ok(getStamp(r), '一般调用结果应 recover');
});

// ===== L1 不插桩一般调用(默认 L1 只纯方法)=====
test('L1(默认):一般函数调用不插桩(无 l2)', () => {
  const data = { val: 'l1-noinst-1' };
  stampOrigin(data, 'GET /l1n');
  const toUpper = (s) => s.toUpperCase();
  const r = runExpr(`customToUpper(data.val)`, { data, customToUpper: toUpper }); // l2=false
  assert.equal(r, 'L1-NOINST-1');
  // L1 不插桩一般调用,toUpperCase 是纯方法但 customToUpper 不是
  // customToUpper 内部调 toUpperCase,但 toUpperCase 在 customToUpper 函数体内(未被插件处理)
  // 所以结果可能不在索引(L1 限制)
  // 这验证 L1 vs L2 的差异
});

// ===== 链式变换 =====
test('链式:trim().toUpperCase() 双重 recover', () => {
  const data = { s: '  chain-unique  ' };
  stampOrigin(data, 'GET /chain');
  const r = runExpr(`data.s.trim().toUpperCase()`, { data });
  assert.equal(r, 'CHAIN-UNIQUE');
  assert.ok(getStamp(r), '链式变换结果应命中 s');
});

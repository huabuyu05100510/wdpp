// passthrough.conformance.js - 深拷贝 pass-through(§7.7)一致性
// 验证:深拷贝后新对象递归带 identity(非 byVal 值反查)、字段级 SM 复制、不碰撞。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp } from '../src/value-index.js';
import { smGet } from '../src/sm.js';
import { __passthrough, __recover } from '../src/babel-runtime.js';

function tx(src) {
  return transformSync(src, { filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin] });
}
function run(src, vars) {
  const out = tx(src);
  const keys = Object.keys(vars);
  const fn = new Function(...keys, '__passthrough', '__recover', `return ${out.code};`);
  return fn(...keys.map(k => vars[k]), __passthrough, __recover);
}

test('深拷贝 __passthrough:新对象递归带 identity(非 byVal)', () => {
  const rec = { name: 'dc-name-1', age: 42, status: 0 };
  stampOrigin(rec, 'GET /dc');
  const cloneDeep = (o) => JSON.parse(JSON.stringify(o));
  const result = run('cloneDeep(rec)', { rec, cloneDeep });
  assert.notEqual(result, rec, '新对象身份');
  assert.ok(getStamp(result)?.passport, '新对象带 objectIndex identity');
  assert.ok(result.__wdpp_fields, '新对象带 __wdpp_fields(字段位并集)');
  assert.ok(smGet(result, 'status'), 'SM 字段槽位复制(含低熵 status)');
  assert.ok(smGet(result, 'name'), 'SM name 复制');
});

test('深拷贝 __passthrough:字段级精确(SM 逐字段,非根并集)', () => {
  const rec = { name: 'field-1', status: 0, age: 7 };
  stampOrigin(rec, 'GET /f');
  const cloneDeep = (o) => JSON.parse(JSON.stringify(o));
  const result = run('cloneDeep(rec)', { rec, cloneDeep });
  const slotName = smGet(result, 'name');
  const slotStatus = smGet(result, 'status');
  assert.ok(slotName && slotStatus, 'name/status SM 都复制');
  assert.notEqual(slotName, slotStatus, '字段级精确(不同字段不同护照,非根并集)');
});

test('深拷贝 __passthrough:不碰撞(两对象各自 identity)', () => {
  const a = { name: 'col-a-unique', val: 100 };
  const b = { name: 'col-b-unique', val: 200 };
  stampOrigin(a, 'GET /a');
  stampOrigin(b, 'GET /b');
  const cloneDeep = (o) => JSON.parse(JSON.stringify(o));
  const oa = run('cloneDeep(a)', { a, cloneDeep });
  const ob = run('cloneDeep(b)', { b, cloneDeep });
  const sa = getStamp(oa), sb = getStamp(ob);
  assert.ok(sa && sb, '两对象都带 identity');
  assert.notEqual(sa.passport, sb.passport, '两对象 identity 不碰撞(per-object,非值反查)');
});

test('深拷贝 __passthrough:嵌套对象 identity 递归复制', () => {
  const rec = { user: { name: 'nested-1', level: 5 }, status: 1 };
  stampOrigin(rec, 'GET /n');
  const cloneDeep = (o) => JSON.parse(JSON.stringify(o));
  const result = run('cloneDeep(rec)', { rec, cloneDeep });
  assert.ok(getStamp(result.user)?.passport, '嵌套 user 对象带 identity(递归复制)');
  assert.ok(smGet(result.user, 'name'), '嵌套 user.name SM 复制');
});

test('深拷贝 __passthrough:structuredClone 也识别', () => {
  const rec = { name: 'sc-1', val: 9 };
  stampOrigin(rec, 'GET /sc');
  const structuredClone = (o) => JSON.parse(JSON.stringify(o)); // mock structuredClone
  const result = run('structuredClone(rec)', { rec, structuredClone });
  assert.ok(getStamp(result)?.passport, 'structuredClone 识别为深拷贝,带 identity');
});

test('深拷贝 __passthrough:JSON.parse(JSON.stringify(x)) 模式识别', () => {
  const rec = { name: 'json-1', val: 11 };
  stampOrigin(rec, 'GET /j');
  const result = run('JSON.parse(JSON.stringify(rec))', { rec });
  assert.ok(getStamp(result)?.passport, 'JSON 往返模式识别,新对象带 identity');
});

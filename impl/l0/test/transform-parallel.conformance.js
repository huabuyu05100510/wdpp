// transform-parallel.conformance.js - 库变换护照传播 + 并行接口消歧 + optional chaining
// 验证:① 库作为整体操作符,__recover/__fieldGet 在调用边界把字段护照传到变换结果(dayjs/valueEnum)。
//      ② 并行接口同值:全局值索引撞(count>=2),但 record-scoped 字段位不重叠(按 record 可消歧)。
//      ③ optional chaining 插桩 + ?. 短路保语义。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp, bumpGeneration } from '../src/value-index.js';
import { recover } from '../src/recovery.js';
import {
  __recover, __readProp, __fieldGet, __readPropOptional, __fieldGetOptional, __aggr,
} from '../src/babel-runtime.js';

const HELPERS = { __recover, __readProp, __fieldGet, __readPropOptional, __fieldGetOptional, __aggr };

function runBody(body, vars = {}) {
  const wrap = `(function(){ ${body} })`;
  const out = transformSync(wrap, { filename: 'x.js', babelrc: false, configFile: false, plugins: [[plugin, { l2: true }]] });
  const names = [...Object.keys(HELPERS), ...Object.keys(vars)];
  const vals = [...Object.values(HELPERS), ...Object.values(vars)];
  const factory = new Function(...names, `"use strict"; return ${out.code};`);
  return factory(...vals)();
}
const evalExpr = (expr, vars) => runBody(`return (${expr});`, vars);

// ============ 库变换墙:__recover/__fieldGet 把字段护照传到变换结果 ============
test('库变换链:dayjs-like __recover 链把字段护照传到变换结果', () => {
  bumpGeneration();
  const rec = { updatedAt: '2024-01-01T10:00:00Z' };
  stampOrigin(rec, 'GET /orders');
  const x = rec.updatedAt;
  // 模拟 plugin 包的 dayjs(x).format():__recover(dayjs(x),[x]) -> __recover(<inner>.format(),[<inner>])
  const dayjsObj = {}; recover(dayjsObj, [x]);                       // inner:dayjs 对象盖 x 护照
  const formatted = '2024-01-01 10:00'; recover(formatted, [dayjsObj]); // outer:format 结果盖 dayjsObj 护照
  const s = getStamp(formatted);
  assert.ok(s, '变换结果应有护照(库作整体操作符,__recover 边界传照)');
  const updatedAtBit = rec.__wdpp_fields['updatedAt'];
  assert.ok((s.passport & updatedAtBit) !== 0n, '变换结果护照含 updatedAt 字段位');
});

test('库变换:valueEnum-like __fieldGet 把 key 护照传到 enum 对象', () => {
  bumpGeneration();
  const rec = { status: 'running' };
  stampOrigin(rec, 'GET /list');
  const lookup = { running: { text: 'Running' } };
  const entry = __fieldGet(lookup, rec.status); // valueEnum[rec.status]
  const s = getStamp(entry);
  const statusBit = rec.__wdpp_fields['status'];
  assert.ok(s && (s.passport & statusBit) !== 0n, 'enum 对象应带 status 护照(经 __fieldGet)');
});

// ============ 并行接口:全局撞,record-scoped 可区分 ============
test('并行接口同值:全局值索引撞(count>=2),record-scoped 字段位不重叠', () => {
  bumpGeneration();
  const recA = { name: 'John' }; stampOrigin(recA, 'GET /users');
  const recB = { title: 'John' }; stampOrigin(recB, 'GET /posts');
  const s = getStamp('John');
  assert.ok(s && s.count >= 2, '全局查 John 撞(两并行接口同值,全局区分不出)');
  const aBit = recA.__wdpp_fields['name'];
  const bBit = recB.__wdpp_fields['title'];
  assert.notEqual(aBit, bBit, '两接口字段位不同');
  assert.equal(aBit & bBit, 0n, 'record-scoped 字段位不重叠(按 record 消歧)');
});

// ============ optional chaining:插桩 + ?. 短路保语义 ============
test('optional chaining:user?.name 短路不抛 + 读到值', () => {
  bumpGeneration();
  assert.equal(evalExpr('u?.name', { u: null }), undefined, 'null?.name -> undefined 不抛');
  assert.equal(evalExpr('u?.name', { u: undefined }), undefined, 'undef?.name -> undefined');
  assert.equal(evalExpr('u?.name', { u: { name: 'Grace' } }), 'Grace', 'u?.name 读到值');
});

test('optional chaining:a?.b?.c 链短路', () => {
  bumpGeneration();
  assert.equal(evalExpr('a?.b?.c', { a: null }), undefined, 'null 链短路');
  assert.equal(evalExpr('a?.b?.c', { a: { b: null } }), undefined, '中间 null 短路');
  assert.equal(evalExpr('a?.b?.c', { a: { b: { c: 'deep' } } }), 'deep', '链读到值');
});

test('optional chaining:f?.(x) 短路 + 结果带照', () => {
  bumpGeneration();
  const d = { v: 'in' }; stampOrigin(d, 'GET /r');
  const f = (x) => x + '_out';
  assert.equal(evalExpr('fn?.(d.v)', { fn: null, d }), undefined, 'null?.() -> undefined');
  const r = evalExpr('fn?.(d.v)', { fn: f, d });
  assert.equal(r, 'in_out', 'fn?.(x) 调用');
  assert.ok(getStamp('in_out'), 'f?.(x) 结果带照(__recover)');
});

test('optional chaining:a?.[k] 计算成员短路', () => {
  bumpGeneration();
  assert.equal(evalExpr('a?.[k]', { a: null, k: 'x' }), undefined, 'null?.[k] 短路');
  assert.equal(evalExpr('a?.[k]', { a: { x: 'val' }, k: 'x' }), 'val', 'a?.[k] 读到值');
});

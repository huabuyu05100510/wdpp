// protocol.conformance.js - 协议级一致性套件(WDPP 标准化工件)
// 运行:node --test impl/l0/test/protocol.conformance.js
//
// 本套件只测 WDPP 公共 API(window.__wdpp__.lookup / allEdges / clearProvenance),
// 不 import 任何内部函数。任何 WDPP 实现(本参考实现 / 未来 Vue 原生 / 浏览器原生)
// 只要暴露相同 __wdpp__ 接口,跑同一套即可对齐--这是"多实现 = 真标准"的基础。
//
// Golden case 格式:正例(数据流到 DOM -> lookup 返回 source)+ 反例(字面量 -> lookup 空)。
// 每个实现声明符合 WDPP-L0/L1/L2,跑对应级别的 case。

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let wdpp, document, stampOrigin;

before(async () => {
  // ---- harness:装配任意 WDPP 实现 + DOM ----
  // 此处用参考实现;换实现时只改这段 import
  const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost/' });
  const { window } = dom;
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, Element: window.Element,
    CharacterData: window.CharacterData, HTMLInputElement: window.HTMLInputElement,
    HTMLImageElement: window.HTMLImageElement, HTMLAnchorElement: window.HTMLAnchorElement,
    MutationObserver: window.MutationObserver,
  });
  await import('../src/dom-sink.js');
  const { install } = await import('../src/index.js');
  const so = await import('../src/stamp-origin.js');
  install({ expose: true });
  stampOrigin = so.stampOrigin;
  wdpp = window.__wdpp__;
  document = window.document;
});

function reset() { document.getElementById('app').innerHTML = ''; }

// ============ WDPP-L0 协议 case ============

test('[L0] 数据边:API 值流到文本节点', () => {
  reset();
  stampOrigin({ name: 'proto-ada-1' }, 'GET /p1');
  const el = document.createElement('h1');
  document.getElementById('app').appendChild(el);
  el.textContent = 'proto-ada-1';
  const recs = wdpp.lookup(el);
  assert.ok(recs.length, '应返回血缘记录');
  assert.ok(recs.some(r => r.edgeType === 'data' && r.fieldPath?.includes('name')), '应含 name 数据边');
});

test('[L0] 属性边:src 流到 img', () => {
  reset();
  stampOrigin({ avatar: 'proto-avatar-1.png' }, 'GET /p2');
  const img = document.createElement('img');
  img.setAttribute('src', 'proto-avatar-1.png');
  const recs = wdpp.lookup(img);
  assert.ok(recs.some(r => r.attr === 'src' && r.edgeType === 'data'), '应含 src 属性边');
});

test('[L0] 类型归一化:number 盖戳,字符串查询命中', () => {
  reset();
  stampOrigin({ level: 42 }, 'GET /p3');
  const tn = document.createTextNode(42); // 写 "42"
  const recs = wdpp.lookup(tn);
  assert.ok(recs.length, '"42" 应命中 number 42 的盖戳');
});

test('[L0] 反例:字面量无血缘', () => {
  reset();
  stampOrigin({ name: 'in-data-proto' }, 'GET /p4');
  const el = document.createElement('div');
  el.textContent = '写死的字面量-不在数据里';
  assert.equal(wdpp.lookup(el).length, 0, '字面量不应有边');
});

test('[L0] 反例:field-sensitive -- 不同字段不交叉', () => {
  reset();
  stampOrigin({ a: 'proto-fs-a', b: 'proto-fs-b' }, 'GET /p5');
  const e1 = document.createElement('span'); e1.textContent = 'proto-fs-a';
  const e2 = document.createElement('span'); e2.textContent = 'proto-fs-b';
  const r1 = wdpp.lookup(e1), r2 = wdpp.lookup(e2);
  assert.notEqual(r1[0].fieldId, r2[0].fieldId, '两字段 fieldId 必须不同');
});

test('[L0] 置信度:2 字段同值标 value-match(碰撞未熔断)', () => {
  reset();
  stampOrigin({ x: 'proto-collide-z', y: 'proto-collide-z' }, 'GET /p6');
  const el = document.createElement('b');
  document.getElementById('app').appendChild(el);
  el.textContent = 'proto-collide-z';
  const recs = wdpp.lookup(el);
  assert.ok(recs.length, '碰撞应命中(不假阴性)');
  assert.ok(recs.every(r => r.confidence === 'value-match'), '2 字段碰撞应标 value-match');
});

test('[L0] 置信度:>K 字段同值标 collision(熔断)', () => {
  reset();
  stampOrigin({ a:'pc', b:'pc', c:'pc', d:'pc', e:'pc', f:'pc', g:'pc' }, 'GET /p6b'); // 7 > K=5
  const el = document.createElement('b');
  document.getElementById('app').appendChild(el);
  el.textContent = 'pc';
  const recs = wdpp.lookup(el);
  assert.ok(recs.some(r => r.confidence === 'collision'), '>5 字段应熔断标 collision');
});

test('[L0] 置信度:唯一值标 exact', () => {
  reset();
  stampOrigin({ name: 'proto-unique-exact-1' }, 'GET /p6c');
  const el = document.createElement('b');
  document.getElementById('app').appendChild(el);
  el.textContent = 'proto-unique-exact-1';
  const recs = wdpp.lookup(el);
  assert.ok(recs.some(r => r.confidence === 'exact'), '唯一值应标 exact');
});

test('[L0] clearProvenance:登出后旧值不命中', () => {
  reset();
  stampOrigin({ name: 'before-logout-proto' }, 'GET /p7');
  const el = document.createElement('i'); el.textContent = 'before-logout-proto';
  assert.ok(wdpp.lookup(el).length, '登出前命中');
  wdpp.clearProvenance();
  const el2 = document.createElement('i'); el2.textContent = 'before-logout-proto';
  assert.equal(wdpp.lookup(el2).length, 0, '登出后不应命中(代际回收)');
});

test('[L0] allEdges:返回全图', () => {
  reset();
  stampOrigin({ a: 'proto-all-1', b: 'proto-all-2' }, 'GET /p8');
  const e1 = document.createElement('span'); e1.textContent = 'proto-all-1';
  document.getElementById('app').appendChild(e1);
  const e2 = document.createElement('span'); e2.textContent = 'proto-all-2';
  document.getElementById('app').appendChild(e2);
  const all = wdpp.allEdges();
  assert.ok(all.length >= 2, 'allEdges 应返回所有边');
  assert.ok(all.every(e => e.fieldPath), '每条边应有 fieldPath');
});

// ============ WDPP-L1 协议 case(需 L1 实现) ============
// L1 case 标注 [L1];L0 实现可 skip 这些。

test('[L1] 变换恢复:toUpperCase 出边', async () => {
  reset();
  stampOrigin({ name: 'proto-transform-1' }, 'GET /l1a');
  const { __recover } = await import('../src/babel-runtime.js');
  const r = __recover('proto-transform-1'.toUpperCase(), ['proto-transform-1']);
  const el = document.createElement('h2');
  document.getElementById('app').appendChild(el);
  el.textContent = r;
  const recs = wdpp.lookup(el);
  assert.ok(recs.length, '变换值应命中 name 的护照');
});

test('[L1] 控制边:内联 && 登记 controlIndex', async () => {
  reset();
  stampOrigin({ flag: true }, 'GET /l1b');
  const { __controlAnd, __readSlot } = await import('../src/babel-runtime.js');
  const data = { flag: true };
  stampOrigin(data, 'GET /l1b2');
  // 模拟 Babel 产物:data.flag && 'CONTROLLED-VAL'
  const r = __controlAnd(data.flag, __readSlot(data, ['flag']), () => 'CONTROLLED-VAL');
  const el = document.createElement('em');
  document.getElementById('app').appendChild(el);
  el.textContent = r;
  const recs = wdpp.lookup(el);
  assert.ok(recs.some(e => e.edgeType === 'control'), '应有控制边');
});

// ============ 协议一致性报告 ============
// 实现声明符合级别后,跑对应 case。L0 实现应过所有 [L0] case;L1 实现应过 [L0]+[L1]。
// 反例(不应出边)是硬性要求:任何级别都不许假阳性。

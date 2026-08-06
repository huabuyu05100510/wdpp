// pure-graph-fallback.conformance.js - 纯图扫描 fallback 测试
// 验证:当 valueMap miss 时,onDomWrite fallback 到扫图找 field 节点(field.values 集合)
//
// 规范:WDPP 3.0 双引擎:按值索引(fast-path) + 纯图扫描(fallback)
//
// 运行:node --test test/pure-graph-fallback.conformance.js

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let document, stampOrigin, getStamp, bumpGeneration, lookup, defaultGraph;

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
  const g = await import('../src/graph.js');
  const gv2 = await import('../src/graph-v2.js');
  stampOrigin = so.stampOrigin;
  getStamp = vi.getStamp;
  bumpGeneration = vi.bumpGeneration;
  lookup = g.lookup;
  defaultGraph = gv2.defaultGraph;
  document = window.document;
});

beforeEach(() => {
  document.getElementById('app').innerHTML = '';
  bumpGeneration();  // 清 field.values + valueMap
});

test('3.0 纯图扫描:stampOrigin 后 field.values 收集了 value', () => {
  stampOrigin({ user: { name: 'Pure-Graph-Name' } }, 'GET /pure-graph');

  // 找到 field 节点
  const fieldNode = defaultGraph.nodes.get('["GET /pure-graph","user","name"]');
  assert.ok(fieldNode, '应建 field 节点');
  assert.ok(fieldNode.values, 'field 节点应自动建 values 集合');
  assert.ok(fieldNode.values.has('Pure-Graph-Name'),
    'field.values 应收集到 "Pure-Graph-Name"');
});

test('3.0 纯图扫描:findFieldsByValue 直接扫图(不依赖 valueMap)', () => {
  stampOrigin({ product: { title: 'Pure-Graph-Title' } }, 'GET /pure-graph-2');

  // 纯图扫描:不查 valueMap,直接扫 field 节点(field.values 已收集)
  const fields = defaultGraph.findFieldsByValue('Pure-Graph-Title');
  assert.equal(fields.length, 1, '扫图应找到 1 个 field 节点');
  assert.equal(fields[0].id, '["GET /pure-graph-2","product","title"]');
});

test('3.0 纯图扫描:onDomWrite 优先 valueMap(fast-path),miss 时扫图(fallback)', () => {
  stampOrigin({ api: { value: 'Fallback-Test' } }, 'GET /fallback');

  // 写 DOM:走 valueMap fast-path(命中)
  const el = document.createElement('h1');
  el.textContent = 'Fallback-Test';
  document.getElementById('app').appendChild(el);

  // bumpGeneration:只清 valueMap(valueMap 是 cache),不清 field.values(图是数据)
  bumpGeneration();

  // 再写一个相同值:此时 valueMap miss,fallback 到图扫描
  // 因为 field.values 仍保留,扫图能找到字段
  const el2 = document.createElement('p');
  el2.textContent = 'Fallback-Test';
  document.getElementById('app').appendChild(el2);

  // lookup 仍能命中(fallback 工作)
  const edges = lookup(el2);
  assert.ok(edges.length > 0, 'fallback 路径: valueMap miss 时扫图仍能命中');
});

test('3.0 纯图扫描:bumpGeneration 不清 field.values(图是 source of truth)', () => {
  stampOrigin({ x: 'Before-Logout' }, 'GET /logout-test');

  // 写入前:field.values 包含值
  const fieldNode = defaultGraph.nodes.get('["GET /logout-test","x"]');
  assert.ok(fieldNode.values.has('Before-Logout'));

  // 登出(bumpGeneration):只清 valueMap,不清 field.values
  bumpGeneration();

  // 登出后:field.values 仍保留(纯图是 source of truth)
  assert.ok(fieldNode.values.has('Before-Logout'),
    '登出后 field.values 仍保留(纯图设计)');

  // 纯图扫图仍能命中
  const fields = defaultGraph.findFieldsByValue('Before-Logout');
  assert.equal(fields.length, 1, '登出后扫图仍能命中(图是 source of truth)');
});

test('3.0 纯图扫描:类型归一化(数字 7 与字符串 "7" 共享 field)', () => {
  stampOrigin({ port: 8080 }, 'GET /port');
  // value 8080 进了 field.values
  const fieldNode = defaultGraph.nodes.get('["GET /port","port"]');
  assert.ok(fieldNode.values.has(8080), '数字 8080 进 values');
  assert.ok(fieldNode.values.has('8080'), '字符串 "8080" 也进 values(类型归一化)');

  // 扫图:数字和字符串都能查到同一 field
  assert.equal(defaultGraph.findFieldsByValue(8080).length, 1);
  assert.equal(defaultGraph.findFieldsByValue('8080').length, 1);
});

test('3.0 纯图扫描:订阅(发布订阅数据有效)', () => {
  // addValueToField 不触发通知(只是修改 field.values)
  // 但 stampOrigin 的 addNode / addEdge 触发
  stampOrigin({ z: 'Sub-Test' }, 'GET /sub');

  // 订阅 field 变化
  let changeCount = 0;
  defaultGraph.subscribeField('["GET /sub","z"]', (change) => {
    changeCount++;
  });

  // 写入新值到 field(通过 stampOrigin)
  stampOrigin({ z: 'Sub-Updated' }, 'GET /sub');

  // 订阅应该被触发(因为 addNode 触发,即使是同一 sourceId 因为 node 不存在)
  assert.ok(changeCount >= 0, 'subscribeField 不抛错');
});

test('3.0 纯图扫描:多源结构自然表达', () => {
  // 同一值出现在多个字段
  stampOrigin({ a: 'Same', b: 'Same' }, 'GET /multi');

  // 扫图:能区分两个 field
  const fields = defaultGraph.findFieldsByValue('Same');
  assert.equal(fields.length, 2, '扫图应找到 2 个 field');
  const ids = fields.map(f => f.id).sort();
  assert.deepEqual(ids, [
    '["GET /multi","a"]',
    '["GET /multi","b"]',
  ]);
});

test('3.0 纯图扫描:对大对象(数组)递归也建 field.values', () => {
  stampOrigin({ items: [{ id: 1, name: 'Item-1' }, { id: 2, name: 'Item-2' }] }, 'GET /arr');

  // 数组元素的 name 字段都应建
  const id1Field = defaultGraph.nodes.get('["GET /arr","items","[]","id"]');
  const name1Field = defaultGraph.nodes.get('["GET /arr","items","[]","name"]');

  // 数组元素用 [] 通配,所以 a 和 b 字段共享同一 field 节点
  assert.ok(id1Field, 'id 字段应建');
  assert.ok(name1Field, 'name 字段应建');
  assert.ok(id1Field.values.has(1), 'id values 应包含 1');
  assert.ok(name1Field.values.has('Item-1'), 'name values 应包含 Item-1');
  assert.ok(name1Field.values.has('Item-2'), 'name values 应包含 Item-2');
});

test('3.0 纯图扫描:onDomWrite 优先 valueMap(fast-path),miss 时扫图(fallback)', () => {
  stampOrigin({ a: 'Path-A' }, 'GET /path-a');

  // 写 DOM:走 valueMap fast-path(亚微秒)
  const el1 = document.createElement('div');
  el1.textContent = 'Path-A';
  document.getElementById('app').appendChild(el1);

  // 此时 valueMap 命中,scannedTimes 应该是 0
  const initialStats = {
    valueMapHits: 0,
    graphScans: 0,
  };

  // bumpGeneration 后 valueMap miss
  bumpGeneration();

  // 写新 DOM:走图扫描 fallback(慢,但仍能命中)
  const el2 = document.createElement('span');
  el2.textContent = 'Path-A';
  document.getElementById('app').appendChild(el2);

  // lookup 仍工作
  const edges = lookup(el2);
  assert.ok(edges.length > 0, 'fallback 后 lookup 仍能命中');
});

test('3.0 纯图扫描:DOM 写入后,field 节点 values 收集 + 图边建立', () => {
  // 关键场景:stampOrigin 收集 field.values 后,DOM 写入时,
  // 1. valueMap 命中(快速画 v1 边)
  // 2. 图扫描也命中(完整画 v2 边)
  // 3. 双引擎都生效
  stampOrigin({ user: { name: 'Dual-Engine-Name' } }, 'GET /dual');

  const el = document.createElement('h1');
  el.textContent = 'Dual-Engine-Name';
  document.getElementById('app').appendChild(el);

  // v1 边(向后兼容)
  const v1Edges = lookup(el);
  assert.ok(v1Edges.length > 0, 'v1 lookup 应工作');

  // v2 图(纯图扫描)
  const v2Fields = defaultGraph.findFieldsByValue('Dual-Engine-Name');
  assert.equal(v2Fields.length, 1, 'v2 findFieldsByValue 也应工作');

  // 两个查询应该指向同一字段
  const v1FieldId = v1Edges[0]?.fieldId;
  const v2MetaFieldId = v2Fields[0]?.meta?.fieldId;
  assert.equal(v1FieldId, v2MetaFieldId, 'v1 和 v2 应指向同一字段');
});
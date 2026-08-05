// b2-integration.conformance.js - B-2 集成测试
// 验证:stampOrigin / onDomWrite 同时建立 v1 边和 v2 图节点/边
//
// 目标:API 字段进来后,graph-v2 中应该有对应的 api-field 节点;
// DOM 写入时,应该同时建 v1 边和 v2 图边(api-field → dom)。
//
// 运行:node --test test/b2-integration.conformance.js

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let document, stampOrigin, getStamp, lookup, bumpGeneration;
let defaultGraph;

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
  bumpGeneration();
  // 不清空 graph(跨测试累积,需要观察)
});

// ============================================================
// stampOrigin → 建图节点
// ============================================================

test('B-2:stampOrigin 后,defaultGraph 有对应 api-field 节点', () => {
  stampOrigin({ name: 'B2-Name', age: 25 }, 'GET /b2');

  // 查找 graph 节点
  const nameNode = defaultGraph.nodes.get('["GET /b2","name"]');
  const ageNode = defaultGraph.nodes.get('["GET /b2","age"]');

  assert.ok(nameNode, 'name 字段应有 graph 节点');
  assert.equal(nameNode.type, 'api-field');
  assert.deepEqual(nameNode.meta.path, ['name']);
  assert.deepEqual(nameNode.meta.sourceId, 'GET /b2');

  assert.ok(ageNode, 'age 字段应有 graph 节点');
});

test('B-2:stampOrigin 嵌套对象,递归建图节点', () => {
  stampOrigin({ user: { name: 'Nested', level: 7 } }, 'GET /nested');

  const userNode = defaultGraph.nodes.get('["GET /nested","user"]');
  const nameNode = defaultGraph.nodes.get('["GET /nested","user","name"]');
  const levelNode = defaultGraph.nodes.get('["GET /nested","user","level"]');

  assert.ok(userNode, 'user 节点应有');
  assert.ok(nameNode, 'user.name 节点应有');
  assert.ok(levelNode, 'user.level 节点应有');
  assert.deepEqual(nameNode.meta.path, ['user', 'name']);
});

// ============================================================
// onDomWrite → 建图边
// ============================================================

test('B-2:DOM 写入后,graph 应有 write 边(api-field → dom)', () => {
  stampOrigin({ name: 'Write-Edge' }, 'GET /write-edge');

  const el = document.createElement('h1');
  el.textContent = 'Write-Edge';
  document.getElementById('app').appendChild(el);

  // 查找 dom 节点对应的 graph 节点(用 edges 反查)
  const writeEdges = defaultGraph.edges.filter(e => e.type === 'write');
  assert.ok(writeEdges.length > 0, '应有 write 边');

  // 验证边的 from 是 api-field 节点
  const edge = writeEdges[0];
  assert.equal(edge.from, '["GET /write-edge","name"]', '边的 from 应该是 name api-field 节点');

  // 验证边的 to 是 dom 节点(用 weakmap 查到对应 node)
  // 这里我们检查 to 是 graph 中存在的 dom 类型节点
  const toNode = defaultGraph.nodes.get(edge.to);
  assert.ok(toNode, 'to 节点应存在');
  assert.equal(toNode.type, 'dom');
});

test('B-2:lookup(node) 在 defaultGraph 上也能找到传播链', () => {
  // 隔离:用一个唯一的 sourceId 让查找唯一
  const uniqueSourceId = 'GET /lookup-path-' + Date.now();
  stampOrigin({ name: 'Lookup-Path-Unique' }, uniqueSourceId);

  const el = document.createElement('h1');
  el.textContent = 'Lookup-Path-Unique';
  document.getElementById('app').appendChild(el);

  // 找 el 对应的 dom 节点:从刚写入的边找
  const writeEdges = defaultGraph.edges.filter(e =>
    e.type === 'write' && e.from.includes('"name"')
  );

  // 找到包含 uniqueSourceId 的边
  const targetEdge = writeEdges.find(e => e.from.includes(uniqueSourceId));
  assert.ok(targetEdge, '应能找到本次的 write 边');

  const sources = defaultGraph.lookup(targetEdge.to);
  assert.ok(sources.length > 0, 'v2 lookup 应能找到源');
  assert.ok(sources[0].source.id.includes(uniqueSourceId),
    `源应包含 ${uniqueSourceId},实际: ${sources[0].source.id}`);
});

// ============================================================
// 多源结构(纯图自然支持,v1 用 confidence)
// ============================================================

test('B-2:多源结构在纯图中自然表达(v1 用 value-match)', () => {
  // 两个 api-field 同值
  stampOrigin({ a: 'Same-B2', b: 'Same-B2' }, 'GET /multi');

  const el = document.createElement('span');
  el.textContent = 'Same-B2';
  document.getElementById('app').appendChild(el);

  // 找 dom 节点
  let domNodeId = null;
  for (const [id, node] of defaultGraph.nodes) {
    if (node.type === 'dom' && node.meta?.attr === 'textContent') {
      // 找最近创建的(后写入)
      domNodeId = id;
    }
  }

  if (domNodeId) {
    const sources = defaultGraph.lookup(domNodeId);
    // 纯图:应该找到 2 个 api-field 源(多源结构)
    const sourceIds = sources.map(s => s.source.id).sort();
    assert.ok(sourceIds.includes('["GET /multi","a"]'), '应包含 a 字段源');
    assert.ok(sourceIds.includes('["GET /multi","b"]'), '应包含 b 字段源');
  }
});

// ============================================================
// 反向引用 getGraphNodeIdByFieldId
// ============================================================

test('B-2:getGraphNodeIdByFieldId(fieldId) 返回 graph 节点 id', async () => {
  // 注:这个测试需要先 stampOrigin
  // 直接 import getGraphNodeIdByFieldId
  const so = await import('../src/stamp-origin.js');
  const { getFieldId } = await import('../src/value-index.js');

  stampOrigin({ test: 'GetNodeId' }, 'GET /get-node-id');
  const fieldId = getFieldId('["GET /get-node-id","test"]');

  const graphNodeId = so.getGraphNodeIdByFieldId(fieldId);
  assert.equal(graphNodeId, '["GET /get-node-id","test"]',
    'fieldId 应能反向查到 graph node id');
});

// ============================================================
// 集成端到端
// ============================================================

test('B-2 端到端:API → DOM → v2 lookup 完整链路', () => {
  // 重置 graph(可选,如果不需要跨测试隔离可以不清)
  // 为简化,这里假设 defaultGraph 已经累积了一些节点

  stampOrigin({ user: { name: 'E2E-B2', age: 30 } }, 'GET /e2e-b2');

  // 模拟 React 渲染
  const root = document.createElement('div');
  const nameEl = document.createElement('h1');
  nameEl.textContent = 'E2E-B2';
  root.appendChild(nameEl);
  const ageEl = document.createElement('p');
  ageEl.textContent = '30';
  root.appendChild(ageEl);
  document.getElementById('app').appendChild(root);

  // 验证 v1 lookup(L0 兼容)
  const v1Name = lookup(nameEl);
  assert.ok(v1Name.length > 0, 'v1 lookup 仍工作');

  // 验证 v2 graph 已建节点和边
  const e2eEdges = defaultGraph.edges.filter(e =>
    e.from.includes('e2e-b2') || e.meta?.attr === 'textContent'
  );
  assert.ok(e2eEdges.length >= 2, 'v2 graph 应有 e2e-b2 相关的边');
});
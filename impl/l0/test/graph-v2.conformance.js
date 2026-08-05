// graph-v2.conformance.js - 纯图架构骨架测试
// 验证:Graph class 节点 + 边 + lookup + 订阅 + 序列化 + 多图管理
//
// 运行:node --test test/graph-v2.conformance.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProvenanceGraph, GraphManager, defaultGraph, defaultGraphManager } from '../src/graph-v2.js';

// ============================================================
// Graph 基础操作
// ============================================================

test('Graph:添加节点 + 添加边', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'api/user.name', type: 'api-field' });
  g.addNode({ id: 'dom/h1', type: 'dom' });
  g.addEdge({ type: 'write', from: 'api/user.name', to: 'dom/h1' });

  assert.equal(g.nodes.size, 2, '应有 2 个节点');
  assert.equal(g.edges.length, 1, '应有 1 条边');
});

test('Graph:反向索引自动建立', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'a', type: 'api-field' });
  g.addNode({ id: 'b', type: 'expression' });
  g.addNode({ id: 'c', type: 'dom' });
  g.addEdge({ type: 'io', from: 'a', to: 'b' });
  g.addEdge({ type: 'write', from: 'b', to: 'c' });

  assert.equal(g.incoming.get('b')?.length, 1, 'b 应有 1 条入边');
  assert.equal(g.incoming.get('c')?.length, 1, 'c 应有 1 条入边');
  assert.equal(g.outgoing.get('a')?.length, 1, 'a 应有 1 条出边');
});

// ============================================================
// Lookup = 反向遍历
// ============================================================

test('Graph.lookup:DOM → API 字段反向遍历', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'api/user.name', type: 'api-field' });
  g.addNode({ id: 'expr#toUpperCase', type: 'expression' });
  g.addNode({ id: 'dom/h1', type: 'dom' });
  g.addEdge({ type: 'io', from: 'api/user.name', to: 'expr#toUpperCase' });
  g.addEdge({ type: 'transform', from: 'expr#toUpperCase', to: 'dom/h1' });

  const sources = g.lookup('dom/h1');
  assert.equal(sources.length, 1, '应找到 1 个 api-field 源');
  assert.equal(sources[0].source.id, 'api/user.name');
  assert.equal(sources[0].path.length, 2, '应有 2 条边路径');
});

test('Graph.lookup:多源结构(无碰撞概念)', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'api/user.level', type: 'api-field' });
  g.addNode({ id: 'api/character.level', type: 'api-field' });
  g.addNode({ id: 'expr#render', type: 'expression' });
  g.addNode({ id: 'dom/span', type: 'dom' });
  g.addEdge({ type: 'io', from: 'api/user.level', to: 'expr#render' });
  g.addEdge({ type: 'io', from: 'api/character.level', to: 'expr#render' });
  g.addEdge({ type: 'transform', from: 'expr#render', to: 'dom/span' });

  const sources = g.lookup('dom/span');
  assert.equal(sources.length, 2, '应找到 2 个 api-field 源(多源结构)');
  const sourceIds = sources.map(s => s.source.id).sort();
  assert.deepEqual(sourceIds, ['api/character.level', 'api/user.level']);
});

test('Graph.lookup:循环引用不崩', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'a', type: 'api-field' });
  g.addNode({ id: 'b', type: 'expression' });
  g.addEdge({ type: 'io', from: 'a', to: 'b' });
  g.addEdge({ type: 'transform', from: 'b', to: 'a' }); // 循环

  // 应该不无限递归
  const sources = g.lookup('b');
  assert.ok(sources.length >= 0, '循环引用应被 visited 防护');
});

// ============================================================
// 正向遍历 queryField
// ============================================================

test('Graph.queryField:API 字段 → 所有 DOM 节点', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'api/user.name', type: 'api-field' });
  g.addNode({ id: 'dom/h1', type: 'dom' });
  g.addNode({ id: 'dom/span', type: 'dom' });
  g.addEdge({ type: 'write', from: 'api/user.name', to: 'dom/h1' });
  g.addEdge({ type: 'write', from: 'api/user.name', to: 'dom/span' });

  const doms = g.queryField('api/user.name');
  assert.equal(doms.length, 2, '应找到 2 个 DOM 节点');
});

// ============================================================
// 清除操作
// ============================================================

test('Graph.clearNode:清除节点的所有边', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'a', type: 'api-field' });
  g.addNode({ id: 'b', type: 'expression' });
  g.addNode({ id: 'c', type: 'dom' });
  g.addEdge({ type: 'io', from: 'a', to: 'b' });
  g.addEdge({ type: 'transform', from: 'b', to: 'c' });

  g.clearNode('b');
  assert.equal(g.edges.length, 0, '清除 b 后所有边应消失');
});

test('Graph.clear:清空整个图', () => {
  const g = new ProvenanceGraph();
  g.addNode({ id: 'a', type: 'api-field' });
  g.addNode({ id: 'b', type: 'dom' });
  g.addEdge({ type: 'write', from: 'a', to: 'b' });

  g.clear();
  assert.equal(g.nodes.size, 0);
  assert.equal(g.edges.length, 0);
});

// ============================================================
// 细粒度订阅
// ============================================================

test('Graph.subscribeNode:订阅某节点变化', () => {
  const g = new ProvenanceGraph();
  let received = null;
  g.subscribeNode('dom/h1', (change) => { received = change; });
  g.addNode({ id: 'dom/h1', type: 'dom' });
  assert.ok(received, 'addNode 应触发 node 订阅者');
  assert.equal(received.type, 'add-node');
});

test('Graph.subscribeAll:全局订阅', () => {
  const g = new ProvenanceGraph();
  const events = [];
  g.subscribeAll((change) => events.push(change));
  g.addNode({ id: 'a', type: 'api-field' });
  g.addEdge({ type: 'write', from: 'a', to: 'b' });
  assert.ok(events.length >= 2, '应有 2 个事件(node + edge)');
});

test('Graph:subscribeField:订阅某 api-field 源变化', () => {
  const g = new ProvenanceGraph();
  let received = null;
  g.subscribeField('api/user.name', (change) => { received = change; });

  g.addNode({ id: 'api/user.name', type: 'api-field' });
  g.addNode({ id: 'dom/h1', type: 'dom' });
  g.addEdge({ type: 'write', from: 'api/user.name', to: 'dom/h1' });

  assert.ok(received, '订阅字段源应收到变化通知');
});

// ============================================================
// 多图管理(微前端)
// ============================================================

test('GraphManager:多实例隔离', () => {
  const mgr = new GraphManager();
  const g1 = mgr.getGraph('subapp-1');
  const g2 = mgr.getGraph('subapp-2');
  g1.addNode({ id: 'a', type: 'api-field' });
  g2.addNode({ id: 'a', type: 'api-field' });

  // 两个图独立,同一 id 不冲突
  assert.notEqual(g1, g2, '不同实例应是不同 graph');
  assert.equal(g1.nodes.size, 1);
  assert.equal(g2.nodes.size, 1);

  // 销毁不影响其他
  mgr.destroyGraph('subapp-1');
  assert.equal(mgr.graphs.has('subapp-1'), false);
  assert.equal(g2.nodes.size, 1, 'subapp-2 不受影响');
});

// ============================================================
// 序列化 / 反序列化(devtools 持久化)
// ============================================================

test('Graph:serialize / deserialize 往返一致', () => {
  const g1 = new ProvenanceGraph();
  g1.addNode({ id: 'api/user.name', type: 'api-field' });
  g1.addNode({ id: 'dom/h1', type: 'dom' });
  g1.addEdge({ type: 'write', from: 'api/user.name', to: 'dom/h1' });

  const snapshot = g1.serialize();
  const g2 = ProvenanceGraph.deserialize(snapshot);

  assert.equal(g2.nodes.size, 2);
  assert.equal(g2.edges.length, 1);
  const sources = g2.lookup('dom/h1');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].source.id, 'api/user.name');
});

// ============================================================
// 默认实例
// ============================================================

test('defaultGraph:全局单例可访问', () => {
  assert.ok(defaultGraph, 'defaultGraph 应存在');
  assert.equal(defaultGraph.nodes.size, 0, '初始为空');
});

test('defaultGraphManager:全局单例可访问', () => {
  assert.ok(defaultGraphManager, 'defaultGraphManager 应存在');
  const g = defaultGraphManager.getGraph('default');
  assert.ok(g, '应能获取 default 图');
});
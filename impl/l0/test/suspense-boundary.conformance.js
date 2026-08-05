// suspense-boundary.conformance.js - Suspense 边界测试
// 验证:子节点卸载时递归清理边(避免幽灵边)
//
// 背景:React 18+ Suspense 卸载 fallback → 真实组件切换时,
// 子树被整体 removeChild。MutationObserver 收到 removedNodes 顶层节点,
// 但不递归子节点。旧实现只清理顶层,子节点边残留 -> 幽灵边。
//
// P0 修复:clearSubtree 递归清理整棵子树
//
// 运行:node --test test/suspense-boundary.conformance.js

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let document, stampOrigin, getStamp, lookup, bumpGeneration;

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
  stampOrigin = so.stampOrigin;
  getStamp = vi.getStamp;
  bumpGeneration = vi.bumpGeneration;
  lookup = g.lookup;
  document = window.document;
});

beforeEach(() => {
  document.getElementById('app').innerHTML = '';
  bumpGeneration();
});

// ============================================================
// Suspense fallback 模拟测试
// ============================================================

test('Suspense 模拟:fallback 树被卸载后,顶层节点的边被清理', async () => {
  stampOrigin({ loading: 'Loading...' }, 'GET /suspense');

  // 模拟 fallback 树
  const fallback = document.createElement('div');
  fallback.id = 'fallback';
  const tn = document.createTextNode('Loading...');
  fallback.appendChild(tn);
  document.getElementById('app').appendChild(fallback);

  // 写完 fallback,边应存在
  const tnEdgesBefore = lookup(tn);
  assert.ok(tnEdgesBefore.length > 0, 'fallback 子节点写完应有边');

  // 卸载整个 fallback
  fallback.remove();

  // 等 MutationObserver 异步处理
  await new Promise(r => setTimeout(r, 50));

  // fallback 顶层节点的边应被清理
  const fallbackEdgesAfter = lookup(fallback);
  assert.equal(fallbackEdgesAfter.length, 0, 'fallback 顶层节点边应被清理');
});

test('Suspense P0 修复:fallback 树被卸载后,子节点的边也被递归清理', async () => {
  stampOrigin({ loading: 'Loading...' }, 'GET /suspense-child');

  // 模拟嵌套的 fallback 树
  const fallback = document.createElement('div');
  const wrapper = document.createElement('div');
  const tn = document.createTextNode('Loading...');
  wrapper.appendChild(tn);
  fallback.appendChild(wrapper);
  document.getElementById('app').appendChild(fallback);

  // 写完 fallback,边应存在
  const tnEdgesBefore = lookup(tn);
  assert.ok(tnEdgesBefore.length > 0, '嵌套子节点应有边');

  // 卸载整个 fallback 树
  fallback.remove();
  await new Promise(r => setTimeout(r, 50));

  // 子节点的边应被清理(不再有幽灵边)
  const tnEdgesAfter = lookup(tn);
  assert.equal(tnEdgesAfter.length, 0, 'P0 修复:子节点的边应被递归清理');
});

test('Suspense P0 修复:深层嵌套节点的边都被清理', async () => {
  stampOrigin({ deep: 'Deep-Loading' }, 'GET /deep-suspense');

  // 3 层嵌套
  const outer = document.createElement('div');
  const middle = document.createElement('div');
  const inner = document.createElement('div');
  const tn = document.createTextNode('Deep-Loading');
  inner.appendChild(tn);
  middle.appendChild(inner);
  outer.appendChild(middle);
  document.getElementById('app').appendChild(outer);

  // 写完
  const tnEdgesBefore = lookup(tn);
  assert.ok(tnEdgesBefore.length > 0, '深层节点应有边');

  // 卸载最外层
  outer.remove();
  await new Promise(r => setTimeout(r, 50));

  // 所有层的节点边都应被清理
  assert.equal(lookup(tn).length, 0, 'text node 边应清理');
  assert.equal(lookup(inner).length, 0, 'inner 节点边应清理');
  assert.equal(lookup(middle).length, 0, 'middle 节点边应清理');
  assert.equal(lookup(outer).length, 0, 'outer 节点边应清理');
});

test('Suspense P0 修复:卸载后查询新数据不应受残留边影响', async () => {
  stampOrigin({ a: 'AAA', b: 'BBB' }, 'GET /residual');

  // fallback 写 'AAA'
  const fallback = document.createElement('div');
  const tn1 = document.createTextNode('AAA');
  fallback.appendChild(tn1);
  document.getElementById('app').appendChild(fallback);

  // 卸载 fallback
  fallback.remove();
  await new Promise(r => setTimeout(r, 50));

  // 真实组件挂载,写 'BBB'
  const real = document.createElement('div');
  const tn2 = document.createTextNode('BBB');
  real.appendChild(tn2);
  document.getElementById('app').appendChild(real);

  // tn2 应该有边,但不应该受 tn1 残留影响
  const tn2Edges = lookup(tn2);
  assert.ok(tn2Edges.length > 0, '真实组件的边应正确');

  // tn1 不应再有边(已清理)
  const tn1EdgesAfter = lookup(tn1);
  assert.equal(tn1EdgesAfter.length, 0, 'fallback 子节点边应清理(无幽灵边)');
});

// ============================================================
// MutationObserver 自身状态
// ============================================================

test('MutationObserver:观察 childList + subtree(基础验证)', () => {
  // 当前 dom-sink.js 启动时已注册 MutationObserver
  // 验证它能正确触发清理
  stampOrigin({ test: 'Observer-Test' }, 'GET /obs');

  const wrapper = document.createElement('div');
  const tn = document.createTextNode('Observer-Test');
  wrapper.appendChild(tn);
  document.getElementById('app').appendChild(wrapper);

  assert.ok(lookup(tn).length > 0, 'observer 测试前置条件:有边');

  // 立即移除
  wrapper.remove();
  // MutationObserver 异步触发
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(lookup(tn).length, 0, 'observer 异步清理后无边');
      resolve();
    }, 50);
  });
});
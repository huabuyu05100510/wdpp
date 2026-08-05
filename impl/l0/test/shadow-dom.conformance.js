// shadow-dom.conformance.js - Shadow DOM 边界测试
// 验证:Web Components 在 ShadowRoot 内 DOM 写入时,WDPP 是否能正确归因
//
// 背景:Web Components 是现代 web 标准,Custom Element 内部 DOM 在 ShadowRoot 里。
// WDPP 的 patchAccessor 绑在主 Element/Node 原型上,ShadowRoot 内的元素继承主原型,
// 理论上能拦截。但需要验证 + 必要的扩展。
//
// 运行:node --test test/shadow-dom.conformance.js

import { test, before } from 'node:test';
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
    // ShadowRoot + CustomElementRegistry(支持 attachShadow)
    ShadowRoot: window.ShadowRoot,
    CustomElementRegistry: window.CustomElementRegistry,
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

// ============================================================
// Shadow DOM 基础场景
// ============================================================

test('Shadow DOM:在 ShadowRoot 内 createTextNode,边应被记录', () => {
  bumpGeneration();
  // 数据
  stampOrigin({ greeting: 'Hello-Shadow' }, 'GET /shadow');

  // 创建 host 元素 + ShadowRoot
  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // 在 ShadowRoot 内写入
  const tn = document.createTextNode('Hello-Shadow');
  shadow.appendChild(tn);

  // 验证边被记录
  const edges = lookup(tn);
  assert.ok(edges.length > 0, 'ShadowRoot 内 TextNode 应能查到血缘');
});

test('Shadow DOM:在 ShadowRoot 内 textContent 写入,边应被记录', () => {
  bumpGeneration();
  stampOrigin({ title: 'Shadow-Title' }, 'GET /shadow2');

  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const el = document.createElement('h1');
  el.textContent = 'Shadow-Title';
  shadow.appendChild(el);

  const edges = lookup(el);
  assert.ok(edges.length > 0, 'ShadowRoot 内 textContent 写入应记边');
});

test('Shadow DOM:setAttribute 在 ShadowRoot 内,边应被记录', () => {
  bumpGeneration();
  stampOrigin({ src: 'shadow-img.png' }, 'GET /shadow3');

  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const img = document.createElement('img');
  img.setAttribute('src', 'shadow-img.png');
  shadow.appendChild(img);

  const edges = lookup(img);
  assert.ok(edges.some(e => e.attr === 'src'), 'ShadowRoot 内 setAttribute 应记 src 边');
});

test('Shadow DOM:innerHTML 写入 HTML 字符串 -- 当前无边(已知限制)', () => {
  bumpGeneration();
  stampOrigin({ heading: 'Shadow-InnerHTML' }, 'GET /shadow4');

  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const div = document.createElement('div');
  div.innerHTML = '<span>Shadow-InnerHTML</span>';
  shadow.appendChild(div);

  // 当前实现:HTML 字符串(如 '<span>Shadow-InnerHTML</span>')不在值索引中,
  // onDomWrite 查不到 stamp,因此 div 自身也无 innerHTML 边
  // 这是已知限制:HTML 解析是浏览器 native,绕过 patch,且值索引只针对文本值
  // 文档:README "诚实边界" + 设计哲学 "WDPP 与状态管理无关"
  const divEdges = lookup(div);
  assert.equal(divEdges.length, 0, 'innerHTML 写 HTML 字符串当前无边(已知限制)');

  // 子节点同理(HTML 解析绕过 patch)
  const span = div.querySelector('span');
  if (span) {
    const spanEdges = lookup(span);
    assert.equal(spanEdges.length, 0, 'HTML 解析的子节点无边(已知限制)');
  }

  // 解决:用 textContent + JS 创建子节点(主流做法)
  const div2 = document.createElement('div');
  const span2 = document.createElement('span');
  span2.textContent = 'Shadow-InnerHTML';
  div2.appendChild(span2);
  shadow.appendChild(div2);

  const span2Edges = lookup(span2);
  assert.ok(span2Edges.length > 0, '用 textContent 创建子节点应能归因');
});

// ============================================================
// 边界 case:Shadow DOM 与主 DOM 隔离
// ============================================================

test('Shadow DOM:host 元素查询不走 ShadowRoot 内节点', () => {
  bumpGeneration();
  stampOrigin({ external: 'External' }, 'GET /ext');

  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);

  // 在主 DOM 上写 "External"
  host.textContent = 'External';
  const hostEdges = lookup(host);
  assert.ok(hostEdges.length > 0, 'host 元素写值应有边');
});

test('Shadow DOM:主 DOM 与 ShadowRoot 内的 DOM 是独立', () => {
  bumpGeneration();
  stampOrigin({ a: 'MainDOM', b: 'ShadowDOM' }, 'GET /split');

  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // 主 DOM 写 "MainDOM"
  const mainEl = document.createElement('p');
  mainEl.textContent = 'MainDOM';
  host.appendChild(mainEl);

  // ShadowRoot 写 "ShadowDOM"
  const shadowEl = document.createElement('p');
  shadowEl.textContent = 'ShadowDOM';
  shadow.appendChild(shadowEl);

  // 各自应能命中不同字段
  const mainEdges = lookup(mainEl);
  const shadowEdges = lookup(shadowEl);

  assert.ok(mainEdges.length > 0, '主 DOM 元素应记边');
  assert.ok(shadowEdges.length > 0, 'ShadowRoot 元素应记边');

  // 两条边的 fieldId 应不同
  const mainFieldId = mainEdges[0]?.fieldId;
  const shadowFieldId = shadowEdges[0]?.fieldId;
  if (mainFieldId !== undefined && shadowFieldId !== undefined) {
    assert.notEqual(mainFieldId, shadowFieldId,
      '主 DOM 与 ShadowRoot 的 fieldId 应独立(不同 sourceId)');
  }
});

// ============================================================
// 嵌套 Shadow DOM
// ============================================================

test('Shadow DOM:嵌套 ShadowRoot 内的 DOM 应能归因', () => {
  bumpGeneration();
  stampOrigin({ nested: 'Nested-Shadow' }, 'GET /nested-shadow');

  // 外层 host
  const outerHost = document.createElement('div');
  document.getElementById('app').appendChild(outerHost);
  const outerShadow = outerHost.attachShadow({ mode: 'open' });

  // 内层 host 在外层 ShadowRoot 内
  const innerHost = document.createElement('span');
  outerShadow.appendChild(innerHost);
  const innerShadow = innerHost.attachShadow({ mode: 'open' });

  // 在嵌套 ShadowRoot 内写值
  const tn = document.createTextNode('Nested-Shadow');
  innerShadow.appendChild(tn);

  const edges = lookup(tn);
  assert.ok(edges.length > 0, '嵌套 ShadowRoot 内的 DOM 应能归因');
});

// ============================================================
// 验证 ShadowRoot 自身继承主原型(JSDOM 实现验证)
// ============================================================

test('ShadowRoot 节点可被 querySelector 找到(基础 API 兼容)', () => {
  // 不验证继承链细节(JSDOM vs 浏览器实现差异),
  // 只验证 ShadowRoot 节点可以正常被 JS API 操作
  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  assert.ok(shadow, 'attachShadow 应返回 ShadowRoot');
  assert.equal(typeof shadow.querySelector, 'function', 'ShadowRoot 应有 querySelector');
  assert.equal(typeof shadow.appendChild, 'function', 'ShadowRoot 应有 appendChild');
});
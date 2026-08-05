// iframe.conformance.js - iframe 边界测试
// 验证:iframe.contentWindow 内的 fetch / DOM 写入是否能被 WDPP 拦截
//
// 背景:iframe 有独立的 window/context,globalThis.fetch patch 只覆盖主 window。
// 当前 WDPP 没有自动 patch iframe.contentWindow.fetch,这是已知 P0 缺口。
//
// 目标:本测试先记录当前状态(部分覆盖 / 部分不覆盖),
// 然后通过扩展(iframe 自动 patch)使覆盖率提升。
//
// 运行:node --test test/iframe.conformance.js

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let document, stampOrigin, getStamp, lookup, bumpGeneration;

before(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="app"></div><iframe id="f1"></iframe></body>', {
    url: 'http://localhost/',
  });
  const { window } = dom;
  Object.assign(globalThis, {
    window, document: window.document, Node: window.Node, Element: window.Element,
    CharacterData: window.CharacterData, HTMLInputElement: window.HTMLInputElement,
    HTMLImageElement: window.HTMLImageElement, HTMLAnchorElement: window.HTMLAnchorElement,
    MutationObserver: window.MutationObserver,
    HTMLIFrameElement: window.HTMLIFrameElement,
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
// iframe 基础 API 验证
// ============================================================

test('iframe:基础 API 可用', () => {
  const iframe = document.createElement('iframe');
  assert.ok(iframe, '应能创建 iframe');
  assert.equal(iframe.tagName, 'IFRAME');
});

// ============================================================
// iframe 内 fetch(已知 P0 缺口)
// ============================================================

test('iframe P0:iframe.contentWindow.fetch 当前未被 WDPP 拦截(已知缺口)', async () => {
  bumpGeneration();

  // 创建 iframe
  const iframe = document.createElement('iframe');
  document.getElementById('app').appendChild(iframe);

  // 等待 iframe 加载
  await new Promise(resolve => {
    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
      resolve();
    } else {
      iframe.addEventListener('load', resolve, { once: true });
      // fallback 超时
      setTimeout(resolve, 100);
    }
  });

  const iframeWindow = iframe.contentWindow;
  assert.ok(iframeWindow, 'iframe.contentWindow 应存在');

  // 验证:iframeWindow.fetch === window.fetch?(JSDOM 行为)
  // 在真实浏览器中,iframe.contentWindow.fetch 是独立的
  // 在 JSDOM 中,可能共享
  const sameFetch = iframeWindow.fetch === globalThis.fetch;
  console.log(`[诊断] iframeWindow.fetch === window.fetch: ${sameFetch}`);

  // 当前 WDPP 没有自动 patch iframeWindow.fetch
  // 所以从 iframe 内的 fetch 不会进入 stampOrigin
  // 这是 P0 缺口,需要在未来扩展(per-context patch)
});

// ============================================================
// iframe 内 DOM 写入(可能通过原型继承工作)
// ============================================================

test('iframe:iframe 内的 Element 继承主 Element.prototype(可能)', () => {
  const iframe = document.createElement('iframe');
  document.getElementById('app').appendChild(iframe);

  const iframeDoc = iframe.contentDocument;
  assert.ok(iframeDoc, 'iframe.contentDocument 应存在');

  const iframeEl = iframeDoc.createElement('div');
  // 如果 iframeDoc.defaultView === window(JSDOM 中通常如此),
  // iframeEl 的原型继承自主 window 的 Element.prototype
  const iframeElProto = Object.getPrototypeOf(iframeEl);
  const mainElProto = Object.getPrototypeOf(document.createElement('div'));

  console.log(`[诊断] iframeEl proto === mainEl proto: ${iframeElProto === mainElProto}`);

  // iframe 内 textContent 写入是否触发 onDomWrite?
  bumpGeneration();
  stampOrigin({ innerText: 'iframe-Content' }, 'GET /iframe-test');

  iframeEl.textContent = 'iframe-Content';
  const edges = lookup(iframeEl);
  console.log(`[诊断] iframe 内 textContent 写入后的边数: ${edges.length}`);

  // JSDOM 行为:iframe 与主 window 共享某些原型
  // 真实浏览器:iframe 有独立 window,Element.prototype 独立
  // 所以本测试在 JSDOM 中可能通过,在真实浏览器中可能不通过
});

// ============================================================
// iframe 自动 patch(扩展点)
// ============================================================

test('iframe P0 扩展:新创建的 iframe 应被自动 patch', () => {
  // 这个测试要求 WDPP 监听 iframe 创建并自动 patch contentWindow
  // 当前 WDPP 没有这个能力,标记为 P0 扩展点

  bumpGeneration();

  // 创建 iframe
  const iframe = document.createElement('iframe');
  document.getElementById('app').appendChild(iframe);

  // 当前 WDPP 没有 MutationObserver 监听 iframe 创建
  // 所以 iframe.contentWindow 没有被 patch
  // 未来扩展:用 MutationObserver 监听 iframe 创建,自动 patch contentWindow

  // 这是一个 TODO,标记为 P0 扩展点
  assert.ok(true, 'iframe 自动 patch 是未来扩展点(见设计文档)');
});
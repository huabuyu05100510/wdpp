// dom.conformance.js - DOM sink 一致性测试(jsdom)
// 运行:node --test impl/l0/test/dom.conformance.js
// 共享一个 JSDOM + runtime 实例(全局 patch 一次),各测试用唯一值隔离。
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let document, lookup, fieldIdToPath, stampOrigin, getStamp, bumpGeneration;

before(async () => {
  const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { url: 'http://localhost/' });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.CharacterData = window.CharacterData;
  globalThis.HTMLInputElement = window.HTMLInputElement;
  globalThis.HTMLImageElement = window.HTMLImageElement;
  globalThis.HTMLAnchorElement = window.HTMLAnchorElement;
  globalThis.MutationObserver = window.MutationObserver;
  // import 一次,patch 绑到当前 globalThis 原型(window 的原型)
  await import('../src/dom-sink.js');
  const so = await import('../src/stamp-origin.js');
  const vi = await import('../src/value-index.js');
  const g = await import('../src/graph.js');
  stampOrigin = so.stampOrigin;
  getStamp = vi.getStamp;
  bumpGeneration = vi.bumpGeneration;
  fieldIdToPath = vi.fieldIdToPath;
  lookup = g.lookup;
  document = window.document;
});

beforeEach(() => {
  // 清空 app 内容,各测试隔离
  document.getElementById('app').innerHTML = '';
});

test('DOM:文本主通道 textContent 记边', () => {
  stampOrigin({ name: 'Ada-DOM-1' }, 'GET /t1');
  const el = document.createElement('h1');
  document.getElementById('app').appendChild(el);
  el.textContent = 'Ada-DOM-1';
  assert.ok(lookup(el).length, 'textContent 写入应记边');
});

test('DOM:createTextNode 记边', () => {
  stampOrigin({ name: 'Ada-DOM-2' }, 'GET /t2');
  const tn = document.createTextNode('Ada-DOM-2');
  assert.ok(lookup(tn).length, 'createTextNode 应记边');
});

test('DOM:属性 setAttribute 记边', () => {
  stampOrigin({ avatar: 'url-x-1' }, 'GET /a1');
  const img = document.createElement('img');
  img.setAttribute('src', 'url-x-1');
  assert.ok(lookup(img).length, 'setAttribute 应记属性边');
});

test('DOM:property 赋值(value)记边', () => {
  stampOrigin({ q: 'query-val-1' }, 'GET /a2');
  const input = document.createElement('input');
  input.value = 'query-val-1';
  assert.ok(lookup(input).length, 'property value 应记边');
});

test('DOM:类型归一化 -- 数字盖戳,字符串查询命中', () => {
  stampOrigin({ level: 8 }, 'GET /lvl');
  const tn = document.createTextNode(8); // createTextNode(8) -> "8"
  assert.ok(lookup(tn).length, '"8" 应命中 number 8 的盖戳(双形态)');
});

test('DOM:字面量不记边(反例)', () => {
  stampOrigin({ name: 'in-data-zzz' }, 'GET /n');
  const el = document.createElement('div');
  el.textContent = '写死的字面量-不在数据里';
  assert.equal(lookup(el).length, 0, '字面量不该有边');
});

test('DOM:field-sensitive -- 不同字段不同值不交叉', () => {
  stampOrigin({ a: 'val-A-1', b: 'val-B-1' }, 'GET /fs');
  const e1 = document.createElement('span'); e1.textContent = 'val-A-1';
  const e2 = document.createElement('span'); e2.textContent = 'val-B-1';
  const ea = lookup(e1), eb = lookup(e2);
  assert.ok(ea.length && eb.length);
  assert.notEqual(ea[0].fieldId, eb[0].fieldId, '两字段 fieldId 必须不同');
});

test('DOM:点选反查 lookup 返回字段路径', () => {
  stampOrigin({ user: { name: 'click-me-1' } }, 'GET /c');
  const el = document.createElement('h1');
  document.getElementById('app').appendChild(el);
  el.textContent = 'click-me-1';
  const edges = lookup(el);
  assert.ok(edges.length, '应记边');
  const path = fieldIdToPath(edges[0].fieldId);
  assert.ok(path.includes('name'), '应反查到 name 字段');
});

test('DOM:MutationObserver 节点移除清理边', async () => {
  stampOrigin({ name: 'removable-1' }, 'GET /rm');
  const el = document.createElement('span');
  el.textContent = 'removable-1';
  document.getElementById('app').appendChild(el);
  assert.ok(lookup(el).length, '移除前有边');
  el.remove();
  await new Promise(r => setTimeout(r, 50)); // MutationObserver 异步
  assert.equal(lookup(el).length, 0, '移除后边应清理');
});

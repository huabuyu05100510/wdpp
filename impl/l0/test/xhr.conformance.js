// xhr.conformance.js - XHR 拦截通道一致性测试
// 回归:ESM 严格模式下 open 不抛 TypeError(__sourceIdUrl 的 this 绑定 bug 曾让所有 xhr.open() 炸掉)。
// 用 minimal fake XHR 可控地走完 open -> send -> load -> stampOrigin 通道,不依赖网络。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let getStamp, fieldIdToPath, expandBits;

before(async () => {
  // minimal fake XHR:open/send/load 全可控,不连网
  class FakeXHR {
    constructor() { this._listeners = {}; this.responseText = ''; this._respHeaders = {}; }
    open(method, url) { this._method = method; this._url = url; }
    send(body) {
      this._body = body;
      // 模拟异步 load(下一 microtask 触发已注册的 load 回调)
      queueMicrotask(() => {
        for (const fn of (this._listeners.load || [])) fn({ target: this });
      });
    }
    setRequestHeader() {}
    getResponseHeader(k) { return this._respHeaders[k.toLowerCase()] ?? null; }
    addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  }
  globalThis.XMLHttpRequest = FakeXHR;
  // import 触发 patch:stamp-origin 把 open/send patch 到 FakeXHR.prototype
  await import('../src/stamp-origin.js');
  const vi = await import('../src/value-index.js');
  getStamp = vi.getStamp;
  fieldIdToPath = vi.fieldIdToPath;
  expandBits = vi.expandBits;
});

function fireXHR({ method = 'GET', url = '/api/x', body = null,
                   respHeaders = { 'content-type': 'application/json' },
                   responseText = '{}' } = {}) {
  const xhr = new XMLHttpRequest();
  xhr.open(method, url);
  xhr._respHeaders = respHeaders;
  xhr.responseText = responseText;
  return new Promise((resolve) => {
    xhr.addEventListener('load', () => resolve(xhr));
    xhr.send(body);
  });
}

// ===== 回归:bug 核心 =====
test('XHR 回归:open 在严格模式下不抛 TypeError', () => {
  // 修复前:resolveXhrSourceId 内 this.__sourceIdUrl=url,this===undefined -> TypeError
  const xhr = new XMLHttpRequest();
  assert.doesNotThrow(() => xhr.open('GET', '/users/1'));
});

test('XHR:__sourceIdUrl / __sourceId 正确设到实例(open 处 this===xhr)', () => {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/users/42');
  assert.equal(xhr.__sourceIdUrl, '/users/42', '__sourceIdUrl 必须在 open 设到 xhr 实例');
  assert.equal(xhr.__sourceId, 'GET /users/42', 'sourceId = METHOD + stripQuery(url)');
});

// ===== 完整通道:send -> load -> stampOrigin =====
test('XHR:GET JSON 响应被盖戳,值可查', async () => {
  await fireXHR({ url: '/users/1', responseText: JSON.stringify({ user: { name: 'Ada-XHR-1' } }) });
  const s = getStamp('Ada-XHR-1');
  assert.ok(s, 'XHR JSON 响应应被 stampOrigin 盖戳');
  assert.equal(s.collision, false);
});

test('XHR:sourceId 含 method + 路径(query 已剥离)', async () => {
  await fireXHR({ method: 'POST', url: '/api/posts/9?foo=bar',
    responseText: JSON.stringify({ title: 'Title-XHR-2' }) });
  const s = getStamp('Title-XHR-2');
  assert.ok(s);
  const path = fieldIdToPath(expandBits(s.passport)[0]);
  assert.match(path, /POST \/api\/posts\/9/, `sourceId 应含 'POST /api/posts/9'(无 query), got: ${path}`);
});

// ===== GraphQL sourceId 提取(直接验证 __sourceIdUrl 修复)=====
test('XHR:GraphQL sourceId 提取 operationName(用 __sourceIdUrl 取 host)', async () => {
  const body = JSON.stringify({ operationName: 'GetUsers', query: '{ users { name } }' });
  await fireXHR({
    method: 'POST', url: '/graphql', body,
    responseText: JSON.stringify({ data: { users: [{ name: 'Ada-GQL-1' }] } }),
  });
  const s = getStamp('Ada-GQL-1');
  assert.ok(s, 'GraphQL 响应应盖戳');
  const path = fieldIdToPath(expandBits(s.passport)[0]);
  assert.match(path, /graphql:\/\//, `sourceId 应是 graphql:// scheme, got: ${path}`);
  assert.match(path, /GetUsers/, `sourceId 应含 operationName, got: ${path}`);
  // __sourceIdUrl 修复前:maybeGraphQL 收到 url=undefined -> sourceId='graphql://#GetUsers'(无 host)
  assert.ok(!/graphql:\/\/#/.test(path), `sourceId 不应是 graphql://#(说明 __sourceIdUrl 丢失), got: ${path}`);
});

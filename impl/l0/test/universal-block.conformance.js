// universal-block.conformance.js - 通用块级归因一致性(不 by case)
// 验证:1)数据源识别不 by prop 名(任意 prop 名含带照对象都识别) 2)lookup 祖先回退(块级降级)
// 3)字段级优先于块级 4)深拷贝断 identity 时 leafUnion 降级
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let document, stampOrigin, lookup, recordEdge, dataSourcesBits, objectIdentity, leafUnion, getStamp, expandBits, fieldIdToPath;

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
  await import('../src/dom-sink.js');
  const so = await import('../src/stamp-origin.js');
  const vi = await import('../src/value-index.js');
  const g = await import('../src/graph.js');
  const cb = await import('../src/component-bind.js');
  stampOrigin = so.stampOrigin;
  getStamp = vi.getStamp;
  expandBits = vi.expandBits;
  fieldIdToPath = vi.fieldIdToPath;
  lookup = g.lookup;
  recordEdge = g.recordEdge;
  dataSourcesBits = cb.dataSourcesBits;
  objectIdentity = cb.objectIdentity;
  leafUnion = cb.leafUnion;
  document = window.document;
});

beforeEach(() => { document.getElementById('app').innerHTML = ''; });

// ===== 数据源识别:不 by prop 名(通用) =====
test('dataSourcesBits:任意 prop 名含带照对象 -> 识别(不 by name)', () => {
  const rec = { name: 'uni-name-1', age: 42, desc: 'uni-desc-1' };
  stampOrigin(rec, 'GET /u');
  // 任意 prop 名(非旧 DATA_PROP_NAMES 枚举的 dataSource/record/list...)
  for (const propName of ['myData', 'payload', 'foo', 'whatever', 'x']) {
    const bits = dataSourcesBits({ [propName]: rec });
    assert.ok(bits, `prop "${propName}" 含带照对象应识别(不 by name)`);
  }
});

test('dataSourcesBits:旧枚举名也识别(通用不排斥)', () => {
  const rec = { name: 'uni-name-2', age: 7 };
  stampOrigin(rec, 'GET /u2');
  assert.ok(dataSourcesBits({ dataSource: [rec] }), 'dataSource 数组识别');
  assert.ok(dataSourcesBits({ record: rec }), 'record 对象识别');
});

test('dataSourcesBits:静态对象(无 API identity)不识别', () => {
  const staticProps = { config: { theme: 'dark', size: 12 }, items: [{ label: 'a', value: 1 }] };
  assert.equal(dataSourcesBits(staticProps), 0n, '静态对象无 API 护照不应识别');
});

test('dataSourcesBits:数组数据源 -> 并集含所有 record 字段', () => {
  const recs = [{ name: 'r1-uni', age: 11 }, { name: 'r2-uni', age: 22 }];
  stampOrigin(recs, 'GET /list');
  const bits = dataSourcesBits({ items: recs });
  assert.ok(bits, 'items 数组应识别');
  const paths = expandBits(bits).map((id) => fieldIdToPath(id));
  assert.ok(paths.some((p) => p.includes('name')), '并集含 name 字段');
});

// ===== 深拷贝降级(通用,抗 umi 深拷贝) =====
test('leafUnion:深拷贝断 identity/__wdpp_fields,带照叶子降级命中', () => {
  const rec = { name: 'deep-name-1', age: 42, desc: 'deep-desc-1' };
  stampOrigin(rec, 'GET /deep');
  const copy = JSON.parse(JSON.stringify(rec)); // 深拷贝:丢 __wdpp_fields + objectIndex 断(新对象)
  assert.equal(objectIdentity(copy), 0n, '深拷贝断 identity 与 __wdpp_fields');
  const lu = leafUnion(copy);
  assert.ok(lu, 'leafUnion 降级应命中(叶子值在值索引)');
  assert.ok(dataSourcesBits({ myData: copy }), '深拷贝对象靠 leafUnion 识别(通用,不依赖对象身份)');
});

// ===== lookup 分层:字段级优先,块级祖先回退 =====
test('lookup 祖先回退:textNode 无直接边 -> 回退最近 host 块边(block)', () => {
  stampOrigin({ title: 'host-title-1' }, 'GET /h');
  const stamp = getStamp('host-title-1');
  assert.ok(stamp, '盖戳');
  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  for (const id of expandBits(stamp.passport)) recordEdge(id, host, 'data', 'block', null, null);
  const span = document.createElement('span');
  host.appendChild(span);
  const tn = document.createTextNode('no-stamp-text'); // 字面量,无直接边
  span.appendChild(tn);
  const edges = lookup(tn);
  assert.ok(edges.length, 'textNode 无直接边应回退祖先 host 块边');
  assert.equal(edges[0].confidence, 'block', '回退边置信度 block');
  assert.ok(edges.some((e) => fieldIdToPath(e.fieldId).includes('title')), '回退到 host 的 title 块边');
});

test('lookup 字段级优先:textNode 有直接边(exact) -> 不回退', () => {
  stampOrigin({ name: 'direct-name-1' }, 'GET /d');
  const stamp = getStamp('direct-name-1');
  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  // host 块边
  for (const id of expandBits(stamp.passport)) recordEdge(id, host, 'data', 'block', null, null);
  // textNode 直接边(createTextNode 触发 onDomWrite,字段级 exact)
  const tn = document.createTextNode('direct-name-1');
  host.appendChild(tn);
  const edges = lookup(tn);
  assert.ok(edges.some((e) => e.confidence === 'exact'), '字段级 exact 优先于块级回退');
});

test('lookup noFallback:关闭回退只取字段级', () => {
  stampOrigin({ title: 'nf-title-1' }, 'GET /nf');
  const stamp = getStamp('nf-title-1');
  const host = document.createElement('div');
  document.getElementById('app').appendChild(host);
  for (const id of expandBits(stamp.passport)) recordEdge(id, host, 'data', 'block', null, null);
  const tn = document.createTextNode('literal');
  host.appendChild(tn);
  assert.equal(lookup(tn, { noFallback: true }).length, 0, 'noFallback 时无字段级边则空');
  assert.ok(lookup(tn).length, '默认回退有块边');
});

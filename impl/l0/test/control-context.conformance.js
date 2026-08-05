// control-context.conformance.js - if/else/for/while 体的控制上下文栈回归
// 历史 bug:非 return 的 if 体 / else 体 / 循环体 emit 了 __controlExit,却把 __controlEnter
//   丢弃(unshift(enter) 后 body=[tryStmt] 覆盖)-> 体执行时控制栈空 -> DOM 写入记不上控制边;
//   嵌套场景下内层 __controlExit 还会误 pop 外层上下文(栈错位)。
// 运行:node --test impl/l0/test/control-context.conformance.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';

let document, lookup, fieldIdToPath, stampOrigin;
let __readSlot, __controlEnter, __controlExit, getControlStack,
  __writeField, __recoverSelf, __recover, __readField, __nullish,
  __optionalChain, __deleteField, __taggedTemplate, __await, __classPropertyInit, __throw;

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
  const rt = await import('../src/babel-runtime.js');
  const ci = await import('../src/control-index.js');
  stampOrigin = so.stampOrigin;
  fieldIdToPath = vi.fieldIdToPath;
  lookup = g.lookup;
  __readSlot = rt.__readSlot;
  __controlEnter = rt.__controlEnter;
  __controlExit = rt.__controlExit;
  __writeField = rt.__writeField;
  __recoverSelf = rt.__recoverSelf;
  __recover = rt.__recover;
  __readField = rt.__readField;
  __nullish = rt.__nullish;
  __optionalChain = rt.__optionalChain;
  __deleteField = rt.__deleteField;
  __taggedTemplate = rt.__taggedTemplate;
  __await = rt.__await;
  __classPropertyInit = rt.__classPropertyInit;
  __throw = rt.__throw;
  getControlStack = ci.getControlStack;
  document = window.document;
});

beforeEach(() => {
  document.getElementById('app').innerHTML = '';
  while (getControlStack().length) __controlExit(); // 清残留
});

function tx(src) {
  return transformSync(src, { filename: 'x.js', babelrc: false, configFile: false, plugins: [plugin] });
}
function run(out, vars) {
  const keys = Object.keys(vars);
  const fn = new Function(...keys,
    '__readSlot', '__controlEnter', '__controlExit', '__writeField', '__recoverSelf',
    '__recover', '__readField', '__nullish', '__optionalChain', '__deleteField',
    '__taggedTemplate', '__await', '__classPropertyInit', '__throw',
    out.code);
  fn(...keys.map(k => vars[k]),
    __readSlot, __controlEnter, __controlExit, __writeField, __recoverSelf,
    __recover, __readField, __nullish, __optionalChain, __deleteField,
    __taggedTemplate, __await, __classPropertyInit, __throw);
}

// ===== 结构回归:__controlEnter 必须存在且在 __controlExit 前 =====
test('结构:if 非return 体有 enter 且在 exit 前', () => {
  const c = tx(`if (data.flag) { doThing(); }`).code;
  const e = c.indexOf('__controlEnter'), x = c.indexOf('__controlExit');
  assert.notEqual(e, -1, '必须有 __controlEnter(旧 bug 丢弃)');
  assert.ok(e < x, 'enter 必须在 exit 前');
});
test('结构:if-else 非return 体两支都有 enter', () => {
  const c = tx(`if (data.flag) { a(); } else { b(); }`).code;
  assert.ok((c.match(/__controlEnter/g) || []).length >= 2, '两支各一个 enter');
});
test('结构:for/while 体有 enter+exit', () => {
  for (const src of [`for (const x of data.list) { doThing(x); }`, `while (data.cond) { doThing(); }`]) {
    const c = tx(src).code;
    assert.ok(c.includes('__controlEnter'), `循环体应有 enter: ${src}`);
    assert.ok(c.includes('__controlExit'), `循环体应有 exit: ${src}`);
  }
});

// ===== 运行时回归:体内 DOM 写应记上 cond 的控制边(旧 bug:栈空 -> 无控制边)=====
test('运行时:if 体内 DOM 写记 cond 控制边', () => {
  const data = { flag: 'ctrl-if-truthy' };
  stampOrigin(data, 'GET /cif');
  const el = document.createElement('div');
  document.getElementById('app').appendChild(el);
  run(tx(`if (data.flag) { el.textContent = 'OUT-IF'; }`), { data, el });
  assert.equal(getControlStack().length, 0, 'if 体后控制栈应空(enter/exit 配对)');
  const edges = lookup(el);
  assert.ok(edges.length, 'if 体内 DOM 写应记边(字面量无数据边,必有控制边)');
  const ctrl = edges.filter(e => e.edgeType === 'control');
  assert.ok(ctrl.length, '应有 control 边(旧 bug 下为 0)');
  assert.ok(ctrl.some(e => fieldIdToPath(e.fieldId).includes('flag')), '控制边应来自 flag');
});

test('运行时:for 体内 DOM 写记 list 控制边', () => {
  const data = { list: ['for-a-uniq', 'for-b-uniq'] };
  stampOrigin(data, 'GET /cfor');
  const el = document.createElement('ul');
  document.getElementById('app').appendChild(el);
  run(tx(`for (const x of data.list) { el.textContent = x; }`), { data, el });
  assert.equal(getControlStack().length, 0, '循环后控制栈应空');
  const ctrl = lookup(el).filter(e => e.edgeType === 'control');
  assert.ok(ctrl.length, 'for 体 DOM 写应有 control 边');
  assert.ok(ctrl.some(e => fieldIdToPath(e.fieldId).includes('list')), '控制边应来自 list');
});

// ===== 嵌套:内层体的 exit 不应误 pop 外层上下文(旧 bug 栈错位)=====
// 外层用 for 循环(Loop visitor 用原节点不克隆,内层 if 会被重访 transform);内层是非return if 体。
// 旧 bug:两层 enter 都丢失 -> 'OUT' 写入时栈空 -> 无控制边。
// 修复后:外层 list enter + 内层 flag enter 都存活 -> 'OUT' 写入时栈顶 flag -> 记 flag 控制边。
// (早退 region 用 cloneNode 克隆 rest,babel 同趟不重访 -> 其内 if 不被 transform;故外层用 for 而非早退)
test('运行时:嵌套 for { if } -- 内层体 DOM 写记 flag 控制边', () => {
  const data = { list: [{ flag: 'inner-flag-truthy' }] };
  stampOrigin(data, 'GET /cnest');
  const el = document.createElement('div');
  document.getElementById('app').appendChild(el);
  const out = tx(`for (const x of data.list) { if (x.flag) { el.textContent = 'OUT'; } }`);
  run(out, { data, el });
  assert.equal(getControlStack().length, 0, '嵌套后控制栈应空(两层 enter/exit 配对)');
  const ctrl = lookup(el).filter(e => e.edgeType === 'control');
  assert.ok(ctrl.length, '嵌套体 DOM 写应有控制边(旧 bug:两 enter 丢 -> 栈空 -> 无边)');
  assert.ok(ctrl.some(e => fieldIdToPath(e.fieldId).includes('flag')),
    '应记内层 flag 控制边(旧 bug 栈错位会记成外层 list 或无)');
});

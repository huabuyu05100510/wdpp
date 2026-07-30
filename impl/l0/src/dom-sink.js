// dom-sink.js - DOM 写入拦截 + onDomWrite 查值画边 + 相邻文本拼接 + MutationObserver 清理
// 规范:WDPP-L0 §4.3。主通道:CharacterData.nodeValue/data + setAttribute + property 表。

import { getStamp, expandBits, getEntityKey } from './value-index.js';
import { controlGet, getControlStack } from './control-index.js';
import { recordEdge, clearEdges } from './graph.js';

const patched = Symbol('wdpp_patched');

// ============ 文本主通道:CharacterData.nodeValue / .data ============
// React/Vue 写文本主要走这条(不是 textContent)
patchAccessor(CharacterData.prototype, 'nodeValue');
patchAccessor(CharacterData.prototype, 'data');
patchAccessor(Node.prototype, 'textContent'); // 少数路径,在 Node 上
patchAccessor(Element.prototype, 'innerHTML', 'html');

// createTextNode:创建时拿到初始值
const _createTextNode = document.createTextNode.bind(document);
document.createTextNode = function (data) {
  const node = _createTextNode(String(data));
  onDomWrite(node, data);
  return node;
};

// ============ 属性:setAttribute + 已知属性 property 表 ============
const _setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  const r = _setAttribute.call(this, name, value);
  onDomWrite(this, value, name);
  return r;
};

// React 对已知属性走 property 赋值,不走 setAttribute。按 React DOM property 表逐接口 patch(最小集)
patchAccessor(HTMLInputElement.prototype, 'value');
patchAccessor(HTMLInputElement.prototype, 'checked');
patchAccessor(HTMLImageElement.prototype, 'src');
patchAccessor(HTMLAnchorElement.prototype, 'href');
patchAccessor(Element.prototype, 'className', 'class');
patchAccessor(Element.prototype, 'id');
patchAccessor(Element.prototype, 'title');
if (typeof HTMLInputElement !== 'undefined') patchAccessor(HTMLInputElement.prototype, 'placeholder');
if (typeof HTMLImageElement !== 'undefined') patchAccessor(HTMLImageElement.prototype, 'alt');
if (typeof HTMLInputElement !== 'undefined') patchAccessor(HTMLInputElement.prototype, 'disabled');
if (typeof HTMLOptionElement !== 'undefined') patchAccessor(HTMLOptionElement.prototype, 'selected');
if (typeof HTMLButtonElement !== 'undefined') patchAccessor(HTMLButtonElement.prototype, 'disabled');

// style 属性
if (typeof CSSStyleDeclaration !== 'undefined') {
  const _setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value) {
    const r = _setProperty.call(this, name, value);
    onDomWrite(this.ownerNode || this, value, `style.${name}`);
    return r;
  };
}

// innerHTML:substring 匹配(字段值可能是 HTML 片段的一部分)
if (typeof Element !== 'undefined') {
  const _innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (_innerHTML?.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ..._innerHTML,
      set(val) {
        _innerHTML.set.call(this, val);
        onDomWrite(this, val, 'html');
      },
    });
  }
}

// hydration 全 DOM 扫描:SSR 水合不触发 DOM 写,需主动扫描补边
let _hydrationScanned = false;
export function scanHydration(root) {
  if (_hydrationScanned) return;
  _hydrationScanned = true;
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.createTreeWalker) return;
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.nodeType === 3) {
      if (node.nodeValue) onDomWrite(node, node.nodeValue);
    } else if (node.nodeType === 1) {
      for (const attr of node.attributes || []) {
        if (attr.value) onDomWrite(node, attr.value, attr.name);
      }
    }
  }
}
// hydration 扫描不自动触发(避免干扰测试/增加启动开销)。
// 用户在 hydration 完成后显式调 window.__wdpp__.scanHydration()。

function patchAccessor(proto, prop, attrName) {
  if (proto[patched]?.[prop]) return;
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc || !desc.set) return;
  Object.defineProperty(proto, prop, {
    ...desc,
    set(val) {
      desc.set.call(this, val);
      onDomWrite(this, val, attrName === undefined ? prop : attrName);
    },
  });
  if (!proto[patched]) proto[patched] = {};
  proto[patched][prop] = true;
}

// ============ onDomWrite:查值画边(数据边 + 控制边,始终都查)============
function onDomWrite(node, value, attrName) {
  if (value === null || value === undefined) return;
  const v = (typeof value === 'object') ? String(value) : value;

  let stamp = getStamp(v);
  // 相邻文本拼接查询:LV.{level} -> 两文本节点 "LV."+"7",拼 "LV.7" 命中
  if (!stamp && isTextNode(node)) {
    stamp = tryConcatAdjacent(node);
  }

  // 控制边:controlIndex + 控制上下文栈(if/while/for 体)
  const ctrls = controlGet(v);
  const stack = getControlStack();
  const stackIds = stack.length ? expandBits(stack[stack.length - 1]) : []; // 取栈顶

  if (!stamp && ctrls.length === 0 && stackIds.length === 0) return; // 字面量且无控制条件,短路

  clearEdges(node); // 重写先清旧边(生命周期)
  const ek = getEntityKey(v); // 记录级血缘
  // 数据边:置信度按 count 分级(exact/value-match/collision)
  if (stamp) {
    const conf = stamp.collision ? 'collision'
               : stamp.count > 1 ? 'value-match'
               : 'exact';
    for (const id of expandBits(stamp.passport)) recordEdge(id, node, 'data', conf, attrName, ek);
  }
  // 控制边:controlIndex(内联 &&/三元)
  for (const c of ctrls) {
    for (const id of expandBits(c.passport)) recordEdge(id, node, 'control', c.conf, attrName, ek);
  }
  // 控制边:上下文栈(if/while/for 体,标 approx)
  for (const id of stackIds) recordEdge(id, node, 'control', 'approx', attrName, ek);
}

// 控制边在 onDomWrite 内一并记(controlGet)。L1 Babel 插件在求值点 controlAdd 登记条件护照。

export { onDomWrite };

function isTextNode(node) {
  return node && node.nodeType === 3; // Node.TEXT_NODE
}

// 拼接相邻文本兄弟查询。挂载规则:仅文本节点、单值 miss 时、同一父元素下相邻文本、不跨元素边界
function tryConcatAdjacent(node) {
  const parent = node.parentNode;
  if (!parent) return null;
  let combined = '';
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) combined += n.nodeValue;
    else if (n.nodeType === 1) { combined = ''; } // 遇元素重置(不跨元素边界)
  }
  if (combined === node.nodeValue) return null; // 没有兄弟,拼了也等于自己
  return getStamp(combined);
}

// ============ MutationObserver:节点移除/合并清理 ============
const mo = new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.removedNodes) clearEdges(n);
  }
});
mo.observe(document, { childList: true, subtree: true });

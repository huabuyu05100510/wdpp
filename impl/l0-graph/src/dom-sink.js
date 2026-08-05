// dom-sink.js — Sink 层
// DOM 写入拦截 + onDomWrite 查图建边 + 给每个 DOM 加 title 属性显示 APIs

import { getStamp, expandBits, fieldIdToPath } from './value-index.js';
import { controlGet, getControlStack } from './control-index.js';
import { addNode, addEdge, clearEdgesFrom, getAncestorApis } from './graph.js';

const patched = Symbol('wdpp_patched');
let _domSeq = 0;
const _domNodes = new WeakMap();  // element → domNodeId

function getDomNodeId(el) {
  let id = _domNodes.get(el);
  if (!id) {
    id = `dom:${++_domSeq}`;
    _domNodes.set(el, id);
    addNode(id, { type: 'DomNode', confidence: 'exact', ref: el });
  }
  return id;
}

/**
 * 核心:onDomWrite — 查图建边 + 更新 title
 */
export function onDomWrite(node, value, attrName) {
  if (value === null || value === undefined) return;
  const v = (typeof value === 'object') ? String(value) : value;

  // 1. 查值 taint(value index fast-path)
  let stamp = getStamp(v);

  // 2. 相邻文本拼接救
  if (!stamp && isTextNode(node)) {
    stamp = tryConcatAdjacent(node);
  }

  // 3. 控制边
  const ctrls = controlGet(v);
  const stack = getControlStack();
  const stackIds = stack.length ? expandBits(stack[stack.length - 1]) : [];

  if (!stamp && ctrls.length === 0 && stackIds.length === 0) return;  // 字面量

  // 4. 建图:DomNode + writes-to 边
  const domId = getDomNodeId(node);
  clearEdgesFrom(domId);  // 重写先清旧

  // 数据边
  if (stamp) {
    const conf = stamp.collision ? 'collision'
               : stamp.count > 1 ? 'value-match'
               : 'exact';
    for (const fid of expandBits(stamp.passport)) {
      addEdge(`field:${fid}`, domId, 'writes-to', conf, { attr: attrName });
    }
  }

  // 控制边:controlIndex
  for (const c of ctrls) {
    for (const fid of expandBits(c.passport)) {
      addEdge(`field:${fid}`, domId, 'conditional-by', c.conf, { attr: attrName });
    }
  }

  // 控制边:控制栈
  for (const fid of stackIds) {
    addEdge(`field:${fid}`, domId, 'conditional-by', 'approx', { attr: attrName });
  }

  // 5. 更新 title 属性(显示 APIs)
  updateTitle(node);
}

/**
 * 更新 DOM 的 title 属性,显示所有相关 APIs
 */
function updateTitle(node) {
  if (!node || !node.parentElement) return;
  const domId = _domNodes.get(node);
  if (!domId) return;

  // 获取所有祖先 APIs
  const apis = getAncestorApis(domId);
  if (apis.length === 0) return;

  // 格式化 APIs
  const apiLabels = apis.map(apiId => {
    const apiNodeId = apiId.replace(/^api:/, '');
    return apiNodeId;
  });

  // 去重
  const unique = [...new Set(apiLabels)];
  const title = `📡 APIs:\n${unique.map(a => `  • ${a}`).join('\n')}`;

  // 给 element 设置 title 属性
  if (node.nodeType === 1) {
    // Element
    node.setAttribute('data-wdpp-apis', unique.join(','));
    node.setAttribute('title', title);
  } else if (node.nodeType === 3) {
    // Text node - 找到父 element 设 title
    const parent = node.parentElement;
    if (parent) {
      // 收集父元素已有的 APIs
      const existing = parent.getAttribute('data-wdpp-apis');
      const existingList = existing ? existing.split(',') : [];
      const merged = [...new Set([...existingList, ...unique])];
      parent.setAttribute('data-wdpp-apis', merged.join(','));
      parent.setAttribute('title', `📡 APIs:\n${merged.map(a => `  • ${a}`).join('\n')}`);
    }
  }
}

/**
 * 尝试相邻文本节点拼接
 */
function tryConcatAdjacent(node) {
  const parent = node.parentNode;
  if (!parent) return null;
  let combined = '';
  for (let n = parent.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3) combined += n.nodeValue;
    else if (n.nodeType === 1) combined = '';
  }
  if (combined === node.nodeValue) return null;
  return getStamp(combined);
}

function isTextNode(node) {
  return node && node.nodeType === 3;
}

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

let _sinkInstalled = false;

export function installSink() {
  if (_sinkInstalled) return;
  _sinkInstalled = true;

  // 文本主通道
  patchAccessor(CharacterData.prototype, 'nodeValue');
  patchAccessor(CharacterData.prototype, 'data');
  patchAccessor(Node.prototype, 'textContent');

  // createTextNode
  const _createTextNode = document.createTextNode.bind(document);
  document.createTextNode = function (data) {
    const node = _createTextNode(String(data));
    onDomWrite(node, data);
    return node;
  };

  // 属性
  const _setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const r = _setAttribute.call(this, name, value);
    onDomWrite(this, value, name);
    return r;
  };

  // 已知属性
  patchAccessor(HTMLInputElement.prototype, 'value');
  patchAccessor(HTMLInputElement.prototype, 'checked');
  patchAccessor(HTMLImageElement.prototype, 'src');
  patchAccessor(HTMLAnchorElement.prototype, 'href');
  patchAccessor(Element.prototype, 'className', 'class');
  patchAccessor(Element.prototype, 'id');
  patchAccessor(Element.prototype, 'title');

  if (typeof HTMLInputElement !== 'undefined') patchAccessor(HTMLInputElement.prototype, 'placeholder');
  if (typeof HTMLImageElement !== 'undefined') patchAccessor(HTMLImageElement.prototype, 'alt');

  // innerHTML
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

  // MutationObserver 清理
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.removedNodes) {
        const domId = _domNodes.get(n);
        if (domId) clearEdgesFrom(domId);
      }
    }
  });
  mo.observe(document, { childList: true, subtree: true });
}

/**
 * Hydration 扫描
 */
export async function scanHydration(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  // 遍历所有 element,扫描带 data-wdpp-apis 的
  const elements = doc.querySelectorAll('[data-wdpp-apis], *');
  for (const el of elements) {
    const apis = el.getAttribute('data-wdpp-apis');
    if (apis) {
      el.setAttribute('title', `📡 APIs:\n${apis.split(',').map(a => `  • ${a}`).join('\n')}`);
    }
  }
}

export function reset() {
  _domSeq = 0;
  // WeakMap 自动 GC
}

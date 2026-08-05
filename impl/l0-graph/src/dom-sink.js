// dom-sink.js — Sink 层
// DOM 写入拦截 + onDomWrite 查图建边 + 给每个 DOM 加 title 属性显示 APIs

import { getStamp, expandBits, fieldIdToPath } from './value-index.js';
import { controlGet, getControlStack } from './control-index.js';
import { addNode, addEdge, clearEdgesFrom, getAncestorApis, allEdges, allNodes } from './graph.js';

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

  // 即使没 stamp,也可能是来自 mutation / readSlot 的字段(没有值索引命中)
  // 这种情况下,我们也尝试通过 fiber 读取拿到 taint

  if (!stamp && ctrls.length === 0 && stackIds.length === 0) {
    // 仍然给一个 'literal' 标记,但不画边
    // 不写 title(字面量没 API 来源)
    return;
  }

  // 4. 找目标 element(text node 的 parent)
  const targetEl = isTextNode(node) ? node.parentElement : node;
  if (!targetEl) return;

  // 5. 建图:DomNode + writes-to 边
  const domId = getDomNodeId(targetEl);

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

  // 6. 更新 title 属性(显示 APIs)
  updateTitle(targetEl);
}

/**
 * 更新 DOM 的 title 属性,显示所有相关 APIs
 */
function updateTitle(el) {
  if (!el || !el.setAttribute) return;

  // 找最近的 dom 节点(包括自身和祖先)
  let cur = el;
  const apis = new Set();
  const MAX = 32;
  let depth = 0;

  while (cur && depth < MAX) {
    const domId = _domNodes.get(cur);
    if (domId) {
      const ancestors = getAncestorApis(domId);
      for (const a of ancestors) apis.add(a);
    }
    cur = cur.parentElement;
    depth++;
  }

  if (apis.size === 0) return;

  const apiLabels = [...apis].map(apiId => apiId.replace(/^api:/, ''));
  const unique = [...new Set(apiLabels)];

  // 写 title 属性 + data-wdpp-apis
  el.setAttribute('data-wdpp-apis', unique.join(','));
  el.setAttribute('title', `📡 APIs: ${unique.join(' | ')}`);
}

/**
 * 收集目标元素的完整 API 集(包括自身和祖先)
 */
function collectApisForElement(el) {
  if (!el) return [];
  const apis = new Set();
  let cur = el;
  let depth = 0;
  const MAX = 32;

  while (cur && depth < MAX) {
    const domId = _domNodes.get(cur);
    if (domId) {
      const ancestors = getAncestorApis(domId);
      for (const a of ancestors) apis.add(a);
    }
    cur = cur.parentElement;
    depth++;
  }
  return [...apis].map(apiId => apiId.replace(/^api:/, ''));
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
 * Hydration 扫描:遍历 DOM 给所有有 src API 的元素补 title
 * (用于异步场景,DOM 已经存在但 WDPP 还没建图)
 */
export async function scanHydration(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  // 1. 触发一次全局重新扫描
  // 2. 遍历所有 element,给有 data-wdpp-apis 的更新 title(从 ancestors 收集)

  // 对每个 element,查它的祖先 domIds,合并 APIs
  const allElements = doc.querySelectorAll('*');
  for (const el of allElements) {
    // 找最近的 dom node(包括自身)
    let cur = el;
    let found = null;
    while (cur && !found) {
      if (_domNodes.has(cur)) found = cur;
      else cur = cur.parentElement;
    }
    if (!found) continue;

    const apis = collectApisForElement(el);
    if (apis.length > 0) {
      const unique = [...new Set(apis)];
      el.setAttribute('data-wdpp-apis', unique.join(','));
      el.setAttribute('title', `📡 APIs: ${unique.join(' | ')}`);
    }
  }
}

export function reset() {
  _domSeq = 0;
  // WeakMap 自动 GC
}

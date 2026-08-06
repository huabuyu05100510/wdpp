// dom-sink.js — Sink 层:数据级 taint 优先,DOM-tree 兜底
// 1. 如果值带 taint(WeakMap 或 __wdpp_api),读其 API(精确)
// 2. 否则沿 DOM 树向上收集 data-wdpp-section(块级)
// 3. MutationObserver 仅作为 last-resort 兜底

import { getTaint } from './labeled-box.js';
import { addNode, addEdge, clearEdgesFrom } from './graph.js';

const patched = Symbol('wdpp_patched');
let _domSeq = 0;
const _domNodes = new WeakMap();
let _processing = false;  // 防止 setAttribute 递归

function getDomNodeId(el) {
  let id = _domNodes.get(el);
  if (!id) {
    id = `dom:${++_domSeq}`;
    _domNodes.set(el, id);
    addNode(id, { type: 'DomNode', ref: el });
  }
  return id;
}

/**
 * 沿 DOM 树向上收集 section 属性(兜底)
 */
function collectApisFromDomTree(el) {
  const apis = new Set();
  let cur = el;
  let depth = 0;
  const MAX = 32;
  while (cur && depth < MAX) {
    if (cur.dataset?.wdppSection) apis.add(cur.dataset.wdppSection);
    cur = cur.parentElement;
    depth++;
  }
  return [...apis];
}

/**
 * 核心:onDomWrite — 数据级 taint 优先,DOM-tree 兜底
 */
export function onDomWrite(node, value, attrName) {
  if (_processing) return;
  if (value === null || value === undefined) return;

  const targetEl = (node.nodeType === 3) ? node.parentElement : node;
  if (!targetEl) return;

  // 1. 数据级:从 value 读 taint(精确)
  let apis = getTaint(value);

  // 2. 兜底:沿 DOM 树收集 section 属性
  if (apis.length === 0) {
    apis = collectApisFromDomTree(targetEl);
  }

  if (apis.length === 0) return;

  // 建图
  const domId = getDomNodeId(targetEl);
  for (const api of apis) {
    addEdge(`api:${api}`, domId, 'writes-to', 'exact', { attr: attrName });
  }

  // 设 title
  _processing = true;
  try {
    targetEl.setAttribute('data-wdpp-apis', apis.join(','));
    targetEl.setAttribute('title', `📡 APIs: ${apis.join(' | ')}`);
  } finally {
    _processing = false;
  }
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

  patchAccessor(CharacterData.prototype, 'nodeValue');
  patchAccessor(CharacterData.prototype, 'data');
  patchAccessor(Node.prototype, 'textContent');

  const _createTextNode = document.createTextNode.bind(document);
  document.createTextNode = function (data) {
    const node = _createTextNode(String(data));
    onDomWrite(node, data);
    return node;
  };

  const _setAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    const r = _setAttribute.call(this, name, value);
    onDomWrite(this, value, name);
    return r;
  };

  patchAccessor(HTMLInputElement.prototype, 'value');
  patchAccessor(HTMLInputElement.prototype, 'checked');
  patchAccessor(HTMLImageElement.prototype, 'src');
  patchAccessor(HTMLAnchorElement.prototype, 'href');
  patchAccessor(Element.prototype, 'className', 'class');
  patchAccessor(Element.prototype, 'id');

  if (typeof HTMLInputElement !== 'undefined') patchAccessor(HTMLInputElement.prototype, 'placeholder');
  if (typeof HTMLImageElement !== 'undefined') patchAccessor(HTMLImageElement.prototype, 'alt');

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

  // MutationObserver 仅作为 last-resort 兜底(innerHTML 后,DOM 树收 section)
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.removedNodes) {
        const domId = _domNodes.get(n);
        if (domId) clearEdgesFrom(domId);
      }
      // 兜底:新 DOM 节点沿父链收 section(数据级 taint 已经在数据本身了)
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) {
          const descendants = [n, ...n.querySelectorAll('*')];
          for (const el of descendants) {
            const apis = collectApisFromDomTree(el);
            if (apis.length > 0 && !el.getAttribute('data-wdpp-apis')) {
              _processing = true;
              try {
                el.setAttribute('data-wdpp-apis', apis.join(','));
                el.setAttribute('title', `📡 APIs: ${apis.join(' | ')}`);
              } finally {
                _processing = false;
              }
            }
          }
        }
      }
    }
  });
  mo.observe(document, { childList: true, subtree: true });
}

export async function scanHydration(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  // Hydration 兜底:对所有带 data-wdpp-section 的 section,补后代 title
  const sections = doc.querySelectorAll('[data-wdpp-section]');
  for (const section of sections) {
    const api = section.dataset.wdppSection;
    section.setAttribute('data-wdpp-apis', api);
    section.setAttribute('title', `📡 APIs: ${api}`);
    const descendants = section.querySelectorAll('*');
    for (const el of descendants) {
      if (!el.getAttribute('data-wdpp-apis')) {
        const apis = collectApisFromDomTree(el);
        if (apis.length > 0) {
          el.setAttribute('data-wdpp-apis', apis.join(','));
          el.setAttribute('title', `📡 APIs: ${apis.join(' | ')}`);
        }
      }
    }
  }
}

export function reset() {
  _domSeq = 0;
}

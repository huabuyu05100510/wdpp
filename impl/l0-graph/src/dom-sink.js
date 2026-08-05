// dom-sink.js — 简化的 API 级块级归因
// 不查值索引,沿 DOM 树向上找带 data-wdpp-section 的祖先,收集所有 API

import { addNode, addEdge, clearEdgesFrom } from './graph.js';

const patched = Symbol('wdpp_patched');
let _domSeq = 0;
const _domNodes = new WeakMap();

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
 * 核心:沿 DOM 树向上收集所有 API
 * @param {Element} el - 起始元素(text node 的 parent)
 * @returns {string[]} API 列表(去重)
 */
export function collectApisForElement(el) {
  const apis = new Set();
  let cur = el;
  let depth = 0;
  const MAX = 32;

  while (cur && depth < MAX) {
    // 检查 data-wdpp-section 属性
    if (cur.dataset?.wdppSection) {
      apis.add(cur.dataset.wdppSection);
    }
    // 检查 data-wdpp-api(单元素标)
    if (cur.dataset?.wdppApi) {
      apis.add(cur.dataset.wdppApi);
    }
    // 检查 __wdpp_api 自有属性(对象标记,如 API 响应对象)
    if (cur.__wdpp_api) {
      apis.add(cur.__wdpp_api);
    }
    cur = cur.parentElement;
    depth++;
  }
  return [...apis];
}

/**
 * DOM 写入拦截:收集祖先 API,设 title
 */
export function onDomWrite(node, value, attrName) {
  if (value === null || value === undefined) return;

  // 找目标 element(text node 的 parent)
  const targetEl = (node.nodeType === 3) ? node.parentElement : node;
  if (!targetEl) return;

  const apis = collectApisForElement(targetEl);
  if (apis.length === 0) return;

  // 建图(可选)
  const domId = getDomNodeId(targetEl);
  for (const api of apis) {
    addEdge(`api:${api}`, domId, 'writes-to', 'block', { attr: attrName });
  }

  // 设 title 属性
  const title = `📡 APIs: ${apis.join(' | ')}`;
  targetEl.setAttribute('data-wdpp-apis', apis.join(','));
  targetEl.setAttribute('title', title);
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

  // MutationObserver
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
 * Hydration 扫描:遍历 DOM 给所有有 data-wdpp-section 的元素后代补 title
 */
export function scanHydration(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;

  // 找所有 data-wdpp-section 元素,给它们的每个后代设 title
  const sections = doc.querySelectorAll('[data-wdpp-section]');
  for (const section of sections) {
    const api = section.dataset.wdppSection;
    // 给 section 自身设 title
    section.setAttribute('data-wdpp-apis', api);
    section.setAttribute('title', `📡 APIs: ${api}`);

    // 给所有后代 element 设 title
    const descendants = section.querySelectorAll('*');
    for (const el of descendants) {
      // 收集从自身向上的所有 API(避免覆盖已有的)
      const existing = el.getAttribute('data-wdpp-apis');
      const existingList = existing ? existing.split(',') : [];
      const apis = collectApisForElement(el);
      const merged = [...new Set([...existingList, ...apis])];
      if (merged.length > 0) {
        el.setAttribute('data-wdpp-apis', merged.join(','));
        el.setAttribute('title', `📡 APIs: ${merged.join(' | ')}`);
      }
    }
  }
}

export function reset() {
  _domSeq = 0;
}

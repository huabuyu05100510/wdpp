// iframe-patch.js - iframe 上下文自动 patch
// 规范:WDPP P0 扩展。监听 iframe 创建,自动 patch contentWindow 的 fetch + DOM。
//
// 关键洞察:每个 iframe 有独立的 window 和 DOM 原型(不同于主 window)。
// WDPP 的 patchAccessor 绑在主 Element.prototype,不影响 iframe 内的 Element。
// 所以需要 per-context patch:对每个 iframe.contentWindow 递归 patch。
//
// 限制:
// - cross-origin iframe 无法访问 contentWindow(浏览器安全策略)
// - closed ShadowRoot 内部 DOM 不可见(浏览器安全策略)
// - 性能:监听所有 iframe 创建 + load,大页面需注意

import { stampOrigin } from './stamp-origin.js';

// 追踪已 patch 的 window(防重复)
const patchedWindows = new WeakSet();

/**
 * 对一个 window 递归 patch:
 * - globalThis.fetch(API 拦截)
 * - globalThis.XMLHttpRequest(XHR 拦截)
 * - Element/Node/CharacterData prototype(DOM 拦截)
 *
 * @param {Window} win - 要 patch 的 window
 * @param {Document} doc - win 的 document
 */
function patchWindowContext(win, doc) {
  if (!win || !doc) return;
  if (patchedWindows.has(win)) return;
  patchedWindows.add(win);

  try {
    // === fetch ===
    if (win.fetch && !win.__wdpp_fetchPatched) {
      const _fetch = win.fetch;
      win.fetch = async function (input, init) {
        const res = await _fetch.call(win, input, init);
        try {
          const sourceId = resolveFetchSourceId(input, init);
          const clone = res.clone();
          clone.text().then(t => {
            try { stampOrigin(JSON.parse(t), sourceId); } catch {}
          }).catch(() => {});
        } catch {}
        return res;
      };
      win.__wdpp_fetchPatched = true;
    }

    // === XHR ===
    if (win.XMLHttpRequest && !win.__wdpp_xhrPatched) {
      const _open = win.XMLHttpRequest.prototype.open;
      const _send = win.XMLHttpRequest.prototype.send;
      win.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__wdpp_sourceId = `${method} ${url.split('?')[0]}`;
        return _open.call(this, method, url, ...rest);
      };
      win.XMLHttpRequest.prototype.send = function (body) {
        this.addEventListener('load', () => {
          try {
            const ct = this.getResponseHeader('content-type') || '';
            if (ct.includes('json')) {
              const data = JSON.parse(this.responseText);
              stampOrigin(data, this.__wdpp_sourceId || 'GET /unknown');
            }
          } catch {}
        });
        return _send.call(this, body);
      };
      win.__wdpp_xhrPatched = true;
    }

    // === DOM 原型 patch ===
    // 对每个 iframe 内的 document,patch 其 Node/Element/CharacterData prototype
    // 注意:JSDOM 中不同 iframe 的原型可能不共享,需要每个 context 单独 patch
    patchDOMPrototypes(doc);

    // === 监听嵌套 iframe 创建 ===
    observeIframeCreation(doc, win);
  } catch (e) {
    // cross-origin iframe 等情况可能抛错,静默
  }
}

function resolveFetchSourceId(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  const method = (init?.method || (input?.method) || 'GET').toUpperCase();
  return `${method} ${url.split('?')[0]}`;
}

// patch Node/Element/CharacterData prototype(对一个 document context)
// 注意:每个 context 独立 patch,WeakMap 防止重复
const patchedPrototypes = new WeakSet();

function patchDOMPrototypes(doc) {
  if (!doc) return;

  // patch Node prototype(覆盖 textContent)
  if (doc.Node && !patchedPrototypes.has(doc.Node.prototype)) {
    patchPrototype(doc.Node.prototype, 'textContent');
    patchedPrototypes.add(doc.Node.prototype);
  }

  // patch Element prototype(覆盖 innerHTML 等)
  if (doc.Element && !patchedPrototypes.has(doc.Element.prototype)) {
    patchPrototype(doc.Element.prototype, 'innerHTML');
    patchedPrototypes.add(doc.Element.prototype);
  }

  // patch CharacterData prototype(覆盖 data / nodeValue)
  if (doc.CharacterData && !patchedPrototypes.has(doc.CharacterData.prototype)) {
    patchPrototype(doc.CharacterData.prototype, 'data');
    patchPrototype(doc.CharacterData.prototype, 'nodeValue');
    patchedPrototypes.add(doc.CharacterData.prototype);
  }

  // patch HTMLElement 子类型(覆盖 value / src / href 等)
  if (doc.HTMLInputElement) patchPrototype(doc.HTMLInputElement.prototype, 'value');
  if (doc.HTMLImageElement) patchPrototype(doc.HTMLImageElement.prototype, 'src');
  if (doc.HTMLAnchorElement) patchPrototype(doc.HTMLAnchorElement.prototype, 'href');
}

function patchPrototype(proto, prop) {
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc || !desc.set) return;
  if (proto.__wdpp_patched?.[prop]) return;

  Object.defineProperty(proto, prop, {
    ...desc,
    set(val) {
      desc.set.call(this, val);
      // 触发 onDomWrite(简化版,不查值索引,只记录 DOM 写入事件)
      // 注:完整 onDomWrite 需要引用 dom-sink.js 的实现,这里只记录节点
      // 详细归因由主 DOM 的 onDomWrite 处理
      if (typeof window !== 'undefined' && window.__wdpp__) {
        try {
          window.__wdpp__.notifyDomWrite?.(this, val, prop);
        } catch {}
      }
    },
  });
  if (!proto.__wdpp_patched) proto.__wdpp_patched = {};
  proto.__wdpp_patched[prop] = true;
}

// MutationObserver 监听 iframe 创建
const iframeObservers = new WeakSet();

function observeIframeCreation(doc, win) {
  if (!doc || iframeObservers.has(doc)) return;
  iframeObservers.add(doc);

  const handleIframe = (iframe) => {
    if (!iframe || !iframe.contentWindow) return;
    const patchContentWindow = () => {
      const contentWin = iframe.contentWindow;
      const contentDoc = iframe.contentDocument;
      if (contentWin && contentDoc) {
        patchWindowContext(contentWin, contentDoc);
      }
    };
    if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
      patchContentWindow();
    } else {
      iframe.addEventListener('load', patchContentWindow, { once: true });
    }
  };

  // 扫描现有 iframe
  doc.querySelectorAll?.('iframe').forEach(handleIframe);

  // 监听新 iframe
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (node.tagName === 'IFRAME') {
          handleIframe(node);
        }
        // 嵌套查找
        node.querySelectorAll?.('iframe').forEach(handleIframe);
      });
    }
  });
  try {
    observer.observe(doc, { childList: true, subtree: true });
  } catch {}
}

// 入口:对主 window 启动 iframe 监听
let started = false;

export function startIframePatch() {
  if (started) return;
  started = true;

  if (typeof window === 'undefined') return;

  try {
    patchWindowContext(window, document);
    // 也监听主 document 的 iframe 创建
    observeIframeCreation(document, window);
  } catch {}
}

// 默认启动(在 install() 中调用)
export function autoStartIframePatch() {
  // 延迟到下一个 tick,避免与 install 主流程冲突
  setTimeout(startIframePatch, 0);
}
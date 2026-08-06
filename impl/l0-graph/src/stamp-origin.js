// stamp-origin.js — Producer 层:网络拦截 + 递归盖戳 + Proxy 包装
// 关键变化:Proxy 返回原始值,taint 存 WeakMap
// 这样 React/模板/原生运算都透明,不需要 unwrap

import { addNode, addEdge } from './graph.js';
import { setTaint, getTaint } from './labeled-box.js';

let _stampInstalled = false;

function resolveFetchSourceId(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  const method = (init?.method || (input?.method) || 'GET').toUpperCase();
  return `${method} ${url.split('?')[0]}`;
}

function resolveXhrSourceId(method, url) {
  return `${(method || 'GET').toUpperCase()} ${String(url).split('?')[0]}`;
}

/**
 * 给一个对象递归盖戳
 */
function stampNode(obj, sourceId, path = []) {
  if (!obj || typeof obj !== 'object') return;

  // 给对象本身标记 API
  obj.__wdpp_api = sourceId;
  obj.__wdpp_path = path;

  // 递归子节点
  for (const k of Object.keys(obj)) {
    try {
      const v = obj[k];
      if (v !== null && v !== undefined) {
        if (typeof v === 'object') {
          stampNode(v, sourceId, [...path, k]);
        } else {
          // primitive:存 taint
          setTaint(v, sourceId);
        }
      }
    } catch {}
  }
}

/**
 * stampOrigin 主体
 */
export function stampOrigin(obj, sourceId) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  stampNode(obj, sourceId);
  // 创建 ApiSource 节点
  addNode(`api:${sourceId}`, { type: 'ApiSource' });
  return obj;
}

export function installProducers() {
  if (_stampInstalled) return;
  _stampInstalled = true;

  if (globalThis.fetch) {
    const _fetch = globalThis.fetch;
    globalThis.fetch = async function (input, init) {
      const res = await _fetch.call(globalThis, input, init);
      const sourceId = resolveFetchSourceId(input, init);
      try {
        const clone = res.clone();
        clone.text().then(t => {
          try { stampOrigin(JSON.parse(t), sourceId); } catch {}
        }).catch(() => {});
      } catch {}
      return res;
    };
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__sourceId = resolveXhrSourceId(method, url);
      return _open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (body) {
      this.addEventListener('load', () => {
        try {
          const ct = this.getResponseHeader('content-type') || '';
          if (ct.includes('json')) {
            stampOrigin(JSON.parse(this.responseText), this.__sourceId);
          }
        } catch {}
      });
      return _send.call(this, body);
    };
  }
}

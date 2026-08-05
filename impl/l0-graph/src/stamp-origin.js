// stamp-origin.js — Producer 层
// 网络拦截 + 递归盖戳 + 建图(ApiSource 节点 + Field 节点 + stamps 边)

import { getFieldId, stampValue, stampValuePassport, bit, getStamp, expandBits, fieldIdToPath } from './value-index.js';
import { smSet } from './sm.js';
import { addNode, addEdge } from './graph.js';

let _apiSeq = 0;

function resolveFetchSourceId(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  const method = (init?.method || (input?.method) || 'GET').toUpperCase();
  return `${method} ${url.split('?')[0]}`;
}

function resolveXhrSourceId(method, url) {
  return `${(method || 'GET').toUpperCase()} ${String(url).split('?')[0]}`;
}

let _stampInstalled = false;

export function installProducers() {
  if (_stampInstalled) return;
  _stampInstalled = true;

  // fetch
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

  // XHR
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
            const data = JSON.parse(this.responseText);
            stampOrigin(data, this.__sourceId);
          }
        } catch {}
      });
      return _send.call(this, body);
    };
  }

  // JSON.parse 重盖(救序列化边界)
  if (typeof JSON !== 'undefined') {
    const _parse = JSON.parse;
    JSON.parse = function (text, reviver) {
      const data = _parse.call(this, text, reviver);
      if (typeof text === 'string' && data && typeof data === 'object') {
        const stamp = getStamp(text);
        if (stamp?.passport) {
          const ids = expandBits(stamp.passport);
          if (ids.length) {
            const path = fieldIdToPath(ids[0]);
            if (path) {
              try {
                const arr = _parse.call(JSON, path);
                const sourceId = arr[0];
                stampOrigin(data, sourceId);
              } catch {}
            }
          }
        }
      }
      return data;
    };
  }

  // WebSocket
  if (typeof WebSocket !== 'undefined') {
    const _addEvt = WebSocket.prototype.addEventListener;
    WebSocket.prototype.addEventListener = function (type, listener, opts) {
      if (type === 'message') {
        const ws = this;
        const wrapped = function (event) {
          try {
            let sourceId = 'ws://unknown';
            try { const u = new URL(ws.url); sourceId = `ws://${u.host}${u.pathname}`; } catch {}
            if (typeof event.data === 'string') {
              try {
                const parsed = JSON.parse(event.data);
                if (parsed && typeof parsed === 'object') stampOrigin(parsed, sourceId);
              } catch {}
            }
          } catch {}
          return listener.call(this, event);
        };
        return _addEvt.call(this, type, wrapped, opts);
      }
      return _addEvt.call(this, type, listener, opts);
    };
  }
}

/**
 * 核心:递归盖戳 + 建图
 */
export function stampOrigin(obj, sourceId, path = [], visited = new WeakSet()) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return 0n;
  if (visited.has(obj)) return 0n;
  visited.add(obj);

  // 创建 ApiSource 节点(首次)
  const apiNodeId = `api:${sourceId}`;
  if (path.length === 0) {
    addNode(apiNodeId, { type: 'ApiSource', confidence: 'exact' });
  }

  const isArr = Array.isArray(obj);
  let allUnion = 0n;

  const fieldMap = {};

  for (const [k, v] of Object.entries(obj)) {
    const seg = isArr ? '[]' : k;
    const fieldId = getFieldId(JSON.stringify([sourceId, ...path, seg]));
    const fieldNodeId = `field:${fieldId}`;

    // 建图:Field 节点 + stamps 边
    addNode(fieldNodeId, { type: 'Field', confidence: 'exact' });
    addEdge(apiNodeId, fieldNodeId, 'stamps', 'exact');

    if (v !== null && typeof v === 'object') {
      const sub = stampOrigin(v, sourceId, [...path, seg], visited);
      smSet(obj, k, bit(fieldId) | sub);
      fieldMap[k] = bit(fieldId) | sub;
      allUnion |= sub;
    } else {
      stampValue(v, fieldId);
      smSet(obj, k, bit(fieldId));
      fieldMap[k] = bit(fieldId);
      if ([true,false,0,1,'','0','1','true','false',null,undefined].includes(v)) {
        // 低熵值不盖值索引,但保留字段位
      } else {
        allUnion |= bit(fieldId);
      }
    }
  }

  // 对象按 identity 盖子树并集(receiver 过近似)
  stampValuePassport(obj, allUnion);

  // 写入字段位(非可枚举)
  try {
    Object.defineProperty(obj, '__wdpp_fields', {
      value: fieldMap,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  } catch {}

  // byVal 兜底(深拷贝场景)
  if (!isArr) {
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__wdpp_byVal = globalThis.__wdpp_byVal || {};
        for (const k of Object.keys(obj)) {
          if (k === '__wdpp_fields') continue;
          const v = obj[k];
          if (v === null || v === undefined || typeof v === 'object') continue;
          if ([true,false,0,1,'','0','1','true','false',null,undefined].includes(v)) continue;
          globalThis.__wdpp_byVal[v] = fieldMap;
        }
      }
    } catch {}
  }

  return allUnion;
}

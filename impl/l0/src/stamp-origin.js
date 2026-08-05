// stamp-origin.js - I/O 原语拦截 + 递归盖戳建值索引
// 规范:WDPP-L0 §3.4/§4.2。拦 fetch/XHR(覆盖 axios/React Query/Apollo 等),盖戳进值索引。

import { getFieldId, stampValue, stampValuePassport, bit, getStamp, expandBits, fieldIdToPath, setEntityKey } from './value-index.js';
import { smSet } from './sm.js';
import { notifyUpdate } from './graph.js';

// ============ fetch 拦截 ============
const _fetch = globalThis.fetch;
if (_fetch) {
  globalThis.fetch = async function (input, init) {
    const res = await _fetch.call(globalThis, input, init);
    const sourceId = resolveFetchSourceId(input, init);
    // fire-and-forget:克隆读 body 盖戳。不 await(流式响应会挂),不 patch res(app 原生读 json/text/arrayBuffer/body 都不冲突)。
    // 盖戳异步,可能晚于 app render;overlay 3s 周期 scanHydration 会补上。
    try {
      const clone = res.clone();
      clone.text().then((t) => { try { stampOrigin(JSON.parse(t), sourceId); } catch {} }).catch(() => {});
    } catch {}
    return res;
  };
}

function patchResponse() {} // 不再 patch res(app 原生读;fire-and-forget clone 盖戳)

// 粗估对象节点数(决定用同步还是分片)
function estimateNodes(obj) {
  if (!obj || typeof obj !== 'object') return 0;
  if (Array.isArray(obj)) return obj.length + obj.reduce((s, e) => s + estimateNodes(e), 0);
  return 1 + Object.values(obj).reduce((s, e) => s + estimateNodes(e), 0);
}

// ============ XHR 拦截(axios 走这条)============
if (typeof XMLHttpRequest !== 'undefined') {
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    // __sourceIdUrl 必须在此处设(此时 this===xhr 实例),供 send 里 maybeGraphQL 提取 host。
    // 不能放进 resolveXhrSourceId--它是普通函数调用,ESM 严格模式下 this===undefined,
    // 赋值会抛 TypeError 让所有 xhr.open() 失败(此前 XHR 通道被合成测试完全漏掉)。
    this.__sourceIdUrl = url;
    this.__sourceId = resolveXhrSourceId(method, url);
    return _open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('load', () => {
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (ct.includes('json')) {
          const data = JSON.parse(this.responseText);
          let sid = this.__sourceId;
          if (body && typeof body === 'string') sid = maybeGraphQL(sid, body, this.__sourceIdUrl);
          stampOrigin(data, sid);
        }
      } catch { /* 非 JSON 或解析失败,忽略 */ }
    });
    return _send.call(this, body);
  };
}

// ============ JSON.parse 全局重盖(救五条通道:localStorage/WebSocket/SSE/postMessage/缓存)============
// 若输入串有护照(来自 API 经 stringify 存入),按 sourceId 逐叶子重盖,避免全响应并集。
const _parse = JSON.parse;
JSON.parse = function (text, reviver) {
  const data = reviver ? _parse.call(this, text, reviver) : _parse.call(this, text);
  if (typeof text === 'string' && data && typeof data === 'object') {
    const stamp = getStamp(text);
    if (stamp && stamp.passport) {
      const ids = expandBits(stamp.passport);
      if (ids.length) {
        const path = fieldIdToPath(ids[0]);
        if (path) {
          try {
            const arr = _parse.call(JSON, path);
            const sourceId = arr[0];
            stampOrigin(data, sourceId);
          } catch { /* 路径解析失败,忽略 */ }
        }
      }
    }
  }
  return data;
};

// ============ WebSocket 拦截 ============
if (typeof WebSocket !== 'undefined') {
  const _wsAddEvt = WebSocket.prototype.addEventListener;
  WebSocket.prototype.addEventListener = function (type, listener, opts) {
    if (type === 'message') {
      const ws = this;
      const wrapped = function (event) {
        try {
          let sourceId = 'ws://unknown';
          try { const u = new URL(ws.url); sourceId = `ws://${u.host}${u.pathname}`; } catch {}
          if (typeof event.data === 'string') {
            const parsed = _parse.call(JSON, event.data);
            if (parsed && typeof parsed === 'object') stampOrigin(parsed, sourceId);
          } else if (event.data && typeof event.data === 'object') {
            stampOrigin(event.data, sourceId);
          }
        } catch { /* 非 JSON,忽略 */ }
        return listener.call(this, event);
      };
      return _wsAddEvt.call(this, type, wrapped, opts);
    }
    return _wsAddEvt.call(this, type, listener, opts);
  };
}

// ============ SSE(EventSource)拦截 ============
if (typeof EventSource !== 'undefined') {
  const _esAddEvt = EventSource.prototype.addEventListener;
  EventSource.prototype.addEventListener = function (type, listener, opts) {
    if (type === 'message') {
      const es = this;
      const wrapped = function (event) {
        try {
          let sourceId = 'sse://unknown';
          try { const u = new URL(es.url); sourceId = `sse://${u.host}${u.pathname}`; } catch {}
          if (event.data && typeof event.data === 'string') {
            const parsed = _parse.call(JSON, event.data);
            if (parsed && typeof parsed === 'object') stampOrigin(parsed, sourceId);
          }
        } catch {}
        return listener.call(this, event);
      };
      return _esAddEvt.call(this, type, wrapped, opts);
    }
    return _esAddEvt.call(this, type, listener, opts);
  };
}

// ============ postMessage 拦截(接收侧)============
if (typeof window !== 'undefined') {
  const _winAddEvt = window.addEventListener;
  window.addEventListener = function (type, listener, opts) {
    if (type === 'message') {
      const wrapped = function (event) {
        try {
          const sourceId = `postMessage://${event.origin || 'unknown'}`;
          if (event.data && typeof event.data === 'object') {
            stampOrigin(event.data, sourceId);
          } else if (typeof event.data === 'string') {
            const parsed = _parse.call(JSON, event.data);
            if (parsed && typeof parsed === 'object') stampOrigin(parsed, sourceId);
          }
        } catch {}
        return listener.call(this, event);
      };
      return _winAddEvt.call(this, type, wrapped, opts);
    }
    return _winAddEvt.call(this, type, listener, opts);
  };
}

// ============ SSR 水合数据拦截 ============
if (typeof window !== 'undefined') {
  // Next.js: window.__NEXT_DATA__
  if (window.__NEXT_DATA__?.props) {
    try { stampOrigin(window.__NEXT_DATA__.props, 'ssr://__NEXT_DATA__'); } catch {}
  }
  // 通用:监听 __NEXT_DATA__ 赋值(可能后加载)
  let _nextData = window.__NEXT_DATA__;
  Object.defineProperty(window, '__NEXT_DATA__', {
    get() { return _nextData; },
    set(v) {
      _nextData = v;
      if (v?.props) { try { stampOrigin(v.props, 'ssr://__NEXT_DATA__'); } catch {} }
    },
    configurable: true,
  });
}

// ============ sourceId 解析(canonical = 原始 URL/method)============
function resolveFetchSourceId(input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? '');
  const method = (init?.method || (input?.method) || 'GET').toUpperCase();
  const cleanUrl = stripQuery(url);
  return `${method} ${cleanUrl}`;
}
function resolveXhrSourceId(method, url) {
  return `${(method || 'GET').toUpperCase()} ${stripQuery(url)}`;
}
function stripQuery(url) { return String(url).split('?')[0]; }

// GraphQL:POST /graphql 所有操作共享 sourceId -> 提取 operationName
function maybeGraphQL(defaultSid, body, url) {
  try {
    const parsed = JSON.parse(body);
    if (parsed && parsed.operationName) {
      return `graphql://${stripQuery(url || '')}#${parsed.operationName}`;
    }
  } catch { /* body 不是 JSON,忽略 */ }
  return defaultSid;
}

// ============ stampOrigin:递归盖戳建值索引 ============
// 后序并集 + visited 循环保护 + 路径分段 key + 数组 length + 类型归一化(在 stampValue 内)
export function stampOrigin(obj, sourceId, path = [], visited = new WeakSet()) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return 0n;
  if (visited.has(obj)) return 0n; // 循环引用保护
  visited.add(obj);

  const isArr = Array.isArray(obj);
  let allUnion = 0n;

  const fieldMap = {}; // 字段→护照,写入自有 Symbol 属性(穿透 spread/Object.assign 拷贝)
  for (const [k, v] of Object.entries(obj)) {
    const seg = isArr ? '[]' : k; // 数组元素通配(避免千条列表膨胀 registry)
    const fieldId = getFieldId(JSON.stringify([sourceId, ...path, seg]));

    if (v !== null && typeof v === 'object') {
      const sub = stampOrigin(v, sourceId, [...path, seg], visited); // 后序递归
      // 双写 SM(条件侧车用):obj.k 的字段级护照 = 自身位 ∪ 子树并集
      smSet(obj, k, bit(fieldId) | sub);
      fieldMap[k] = bit(fieldId) | sub;
      if (isArr) {
        stampValue(sub > 0n ? sub : undefined, fieldId); // 子树并集作为"元素值"盖戳(若非 0)
      }
      allUnion |= sub;
    } else {
      stampValue(v, fieldId); // 原始叶子:盖戳(内含类型归一化 + 低熵跳过)
      smSet(obj, k, bit(fieldId)); // 双写 SM:叶子字段级护照
      fieldMap[k] = bit(fieldId);
      // entityKey:若对象有 id 字段,叶子带记录级血缘
      if (!isArr && obj.id != null) setEntityKey(v, obj.id);
      allUnion |= (sub_for(v, fieldId));
    }
  }
  if (isArr) {
    // length 单独盖戳(空态判断 {items.length === 0})
    const lenId = getFieldId(JSON.stringify([sourceId, ...path, 'length']));
    stampValue(obj.length, lenId);
  }
  stampValuePassport(obj, allUnion); // 对象自身按 identity 盖子树并集(过近似 receiver 用)
  // 非可枚举:内部元数据,不泄漏到 Object.keys/JSON.stringify/spread(否则 BigInt 护照致 JSON.stringify 崩 + 污染应用迭代/序列化)。
  //   直接访问 record.__wdpp_fields 仍可用;拷贝(spread/assign/深拷贝)丢则由 byVal 反查兜底(与 umi 深拷贝同路径,两测试床本就走 byVal)。
  try { Object.defineProperty(obj, '__wdpp_fields', { value: fieldMap, enumerable: false, configurable: true, writable: true }); } catch {}
  // 值反查表:umi request/ProTable 深拷贝 record 丢 __wdpp_fields/Symbol 时,用字段值(name 等)反查原 record 的 fieldMap
  if (!isArr) {
    try {
      if (typeof globalThis !== 'undefined') {
        globalThis.__wdpp_byVal = globalThis.__wdpp_byVal || {};
        for (const k of Object.keys(obj)) {
          if (k === '__wdpp_fields') continue;
          const v = obj[k];
          if (v === null || v === undefined || typeof v === 'object') continue;
          if (v === true || v === false || v === 0 || v === 1 || v === '' || v === '0' || v === '1') continue; // 跳低熵(会碰撞)
          globalThis.__wdpp_byVal[v] = fieldMap;
        }
      }
    } catch {}
  }
  // 根调用(path 空)盖戳完成:主动触发归因补扫(异步盖戳晚于 render 的刷新不一致根因,不依赖 3s 轮询)
  if (path.length === 0) { try { notifyUpdate(); } catch {} }
  return allUnion;
}

// ============ stampOriginChunked:分片异步版,不阻塞 main thread ============
// 大响应(千项列表)同步盖戳 2.2ms 阻塞;此版 BFS 分片,每片 CHUNK 个节点后 yield。
// fetch 包装改用 await stampOriginChunked(data, sourceId)(res.json() 本就 async,无缝)。
const CHUNK_SIZE = 200; // 每片处理节点数
const yield_ = typeof scheduler !== 'undefined' && scheduler.yield
  ? () => scheduler.yield()
  : () => new Promise(r => setTimeout(r, 0));

export async function stampOriginChunked(root, sourceId) {
  if (root === null || root === undefined || typeof root !== 'object') return 0n;
  const visited = new WeakSet();
  visited.add(root);
  // BFS 队列:[obj, path]
  const queue = [[root, []]];
  let processed = 0;

  while (queue.length) {
    const [obj, path] = queue.shift();
    const isArr = Array.isArray(obj);
    for (const [k, v] of Object.entries(obj)) {
      const seg = isArr ? '[]' : k;
      const fieldId = getFieldId(JSON.stringify([sourceId, ...path, seg]));
      if (v !== null && typeof v === 'object') {
        if (!visited.has(v)) { visited.add(v); queue.push([v, [...path, seg]]); }
        smSet(obj, k, bit(fieldId)); // SM 先写自身位(子树并集在子节点处理时回填,简化)
      } else {
        stampValue(v, fieldId);
        smSet(obj, k, bit(fieldId));
      }
    }
    if (isArr) {
      const lenId = getFieldId(JSON.stringify([sourceId, ...path, 'length']));
      stampValue(obj.length, lenId);
    }
    processed++;
    if (processed % CHUNK_SIZE === 0) await yield_(); // 分片让出
  }
}
// helper:叶子字段的位(用于并集)-- 不实际盖戳(已盖),只取位
function sub_for(v, fieldId) {
  if (v === null || v === undefined || typeof v === 'object') return 0n;
  // 返回该字段的位(若非低熵)
  if ([true,false,0,1,'','0','1','true','false',null,undefined].includes(v)) return 0n;
  return 1n << BigInt(fieldId);
}

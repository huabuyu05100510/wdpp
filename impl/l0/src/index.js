// index.js - L0 入口:install() 装 patches,opt-in 时挂 window.__wdpp__
// 规范:WDPP-L0。零插桩(无 Babel),纯 runtime。

import './stamp-origin.js'; // 副作用:patch fetch/XHR/WebSocket/SSE/postMessage/SSR/JSON.parse
import './dom-sink.js';     // 副作用:patch DOM APIs + style + hydration scan
import { lookup, queryField, allEdges, subscribe, getCurrentWrite } from './graph.js';
import { bumpGeneration, getCurrentGen, fieldIdToPath, fieldCount } from './value-index.js';
import { scanHydration } from './dom-sink.js';

const subscribers = new Set();
let lastBatch = null;

export function install({ expose = false } = {}) {
  // patches 已在 import 时生效。这里只处理 opt-in 暴露。
  if (expose && typeof window !== 'undefined') {
    window.__wdpp__ = {
      lookup(node, opts) { return lookup(node, opts).map(r => ({ ...r, fieldPath: fieldIdToPath(r.fieldId) })); },
      queryField(fieldId) { return queryField(fieldId); },
      allEdges() { return allEdges().map(e => ({ ...e, fieldPath: fieldIdToPath(e.fieldId) })); },
      clearProvenance() { bumpGeneration(); },
      getCurrentGen,
      fieldCount,
      getCurrentWrite,
      subscribe(cb) { return subscribe(cb); },
      scanHydration,
    };
  }
}

// demo 用:打印当前图
export function dump() {
  return allEdges().map(e => ({
    field: fieldIdToPath(e.fieldId),
    node: e.node,
    attr: e.attr,
    type: e.type,
    confidence: e.conf,
  }));
}

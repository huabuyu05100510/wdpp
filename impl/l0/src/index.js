// index.js - L0 入口:install() 装 patches,opt-in 时挂 window.__wdpp__
// 规范:WDPP-L0。零插桩(无 Babel),纯 runtime。

import './stamp-origin.js'; // 副作用:patch fetch/XHR/WebSocket/SSE/postMessage/SSR/JSON.parse
import './dom-sink.js';     // 副作用:patch DOM APIs + style + hydration scan
import { lookup, queryField, allEdges, subscribe, getCurrentWrite } from './graph.js';
import { bumpGeneration, getCurrentGen, fieldIdToPath, fieldCount } from './value-index.js';
import { scanHydration } from './dom-sink.js';
import { installOverlay } from './overlay.js';
import { __autoDetectReact, __setRCO } from './babel-runtime.js';
import { autoStartIframePatch } from './iframe-patch.js';
import { startL1Monkeypatch } from './l1-monkeypatch.js';
import { defaultGraph, defaultGraphManager, GraphManager, ProvenanceGraph } from './graph-v2.js';

const subscribers = new Set();
let lastBatch = null;

export function install({ expose = false, overlay = false, react = 'auto', l1 = 'off' } = {}) {
  // P0 修复:React 版本自动检测(支持 React 18+ __CLIENT_INTERNALS 与 React 17- ReactCurrentOwner)
  // react='auto'   → 自动检测
  // react='manual' → 跳过检测,host 自己调 __setRCO()
  // react='none'   → 强制不检测(无 React 场景)
  if (react === 'auto') {
    const detected = __autoDetectReact();
    if (!detected) {
      // 检测失败,host 可能后注入;暴露 setter 供调用方手动设置
    }
  } else if (react === 'manual') {
    // 跳过,host 自行处理
  }

  // L1 模式:l1='off' | 'babel' | 'monkeypatch'
  // 'off'         → 纯 L0(无变换恢复)
  // 'babel'       → 用 Babel plugin(项目方自己编译)
  // 'monkeypatch' → 运行时劫持原生方法(零侵入,不需 Babel)
  if (l1 === 'monkeypatch') {
    startL1Monkeypatch();
  }

  // patches 已在 import 时生效。这里只处理 opt-in 暴露。
  if (typeof window !== 'undefined') {
    // P0 扩展:自动 patch iframe 上下文(per-context fetch + DOM)
    autoStartIframePatch();
  }
  if (expose && typeof window !== 'undefined') {
    window.__wdpp__ = {
      // ===== v1 兼容 API(L0 值索引 + 边)=====
      lookup(node, opts) { return lookup(node, opts).map(r => ({ ...r, fieldPath: fieldIdToPath(r.fieldId) })); },
      queryField(fieldId) { return queryField(fieldId); },
      allEdges() { return allEdges().map(e => ({ ...e, fieldPath: fieldIdToPath(e.fieldId) })); },
      clearProvenance() { bumpGeneration(); },
      getCurrentGen,
      fieldCount,
      getCurrentWrite,
      subscribe(cb) { return subscribe(cb); },
      scanHydration,
      // 高级 API:host 可手动设置 fiber getter(L1 用户)
      __setRCO,

      // ===== v2 纯图 API(推荐使用)=====
      // 完整传播链:DOM → 所有 api-field 源节点
      lookupPaths(nodeId) {
        return defaultGraph.lookup(nodeId).map(s => ({
          source: s.source,
          sourcePath: s.source.meta?.sourceId,
          fieldPath: s.source.meta?.path,
          path: s.path.map(e => ({
            type: e.type,
            from: e.from,
            to: e.to,
            meta: e.meta,
          })),
          edgeTypes: s.edgeTypes,
        }));
      },
      // 正向遍历:API 字段 → 所有 DOM 节点
      queryFieldPaths(sourceId) {
        return defaultGraph.queryField(sourceId).map(n => ({
          id: n.id,
          type: n.type,
          meta: n.meta,
        }));
      },
      // 图统计
      graphStats() {
        return {
          nodes: defaultGraph.nodes.size,
          edges: defaultGraph.edges.length,
          graphs: defaultGraphManager.listGraphs().length + 1, // +1 for default
        };
      },
      // 序列化(用于 devtools 持久化)
      serializeGraph() {
        return defaultGraph.serialize();
      },
      // 多图管理
      getGraph(rootId) { return defaultGraphManager.getGraph(rootId); },
      destroyGraph(rootId) { defaultGraphManager.destroyGraph(rootId); },
      listGraphs() { return defaultGraphManager.listGraphs(); },
      // 细粒度订阅(纯图 v2 增强)
      subscribeNode(nodeId, cb) { return defaultGraph.subscribeNode(nodeId, cb); },
      subscribeField(sourceId, cb) { return defaultGraph.subscribeField(sourceId, cb); },
      // 默认图实例(高级用法)
      __graph: defaultGraph,
      __graphManager: defaultGraphManager,
    };
  }
  if (overlay && typeof window !== 'undefined') installOverlay();
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

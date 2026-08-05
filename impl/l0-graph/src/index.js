// index.js — install API
// 入口:调用 install({ expose: true }) 安装所有层

import { installProducers } from './stamp-origin.js';
import { installSink, scanHydration } from './dom-sink.js';
import * as graph from './graph.js';

export function install(opts = {}) {
  const { expose = false, autoScan = true } = opts;

  // 1. Producer 层(网络拦截)
  installProducers();

  // 2. Sink 层(DOM 拦截)
  if (typeof document !== 'undefined') {
    installSink();
  }

  // 3. 暴露 __wdpp__ API
  if (expose && typeof window !== 'undefined') {
    window.__wdpp__ = {
      lookup(node) {
        // 反向 BFS 找所有 ancestor APIs
        const domId = getDomIdFromNode(node);
        if (!domId) return [];
        return graph.getAncestorApis(domId);
      },
      queryField(fieldPath) {
        // 正向查询
        return graph.allEdges().filter(e =>
          e.from.includes(fieldPath) || e.to.includes(fieldPath)
        );
      },
      allEdges: graph.allEdges,
      allNodes: graph.allNodes,
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
      scanHydration,
      reset: () => {
        graph.reset();
      },
    };
  }

  // 4. DOM ready 后自动扫描
  if (autoScan && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scanHydration());
    } else {
      setTimeout(() => scanHydration(), 0);
    }
  }

  return {
    graph,
    scanHydration,
    reset: () => graph.reset(),
  };
}

function getDomIdFromNode(node) {
  if (!node) return null;
  // 从 dom-sink 拿到 _domNodes(私有)
  // 简化:基于 element 路径生成 ID
  if (node.nodeType === 3) return null;  // text node 不直接有 domId
  if (node.nodeType !== 1) return null;
  // 用 querySelector 查带 data-wdpp-apis 的最近祖先
  const el = node.closest('[data-wdpp-apis]');
  if (!el) return null;
  const apis = el.getAttribute('data-wdpp-apis');
  return apis ? `apis:${apis}` : null;
}

// 导出核心模块
export * from './graph.js';
export { stampOrigin } from './stamp-origin.js';
export { onDomWrite, installSink, scanHydration } from './dom-sink.js';
export * from './babel-runtime.js';

export default { install };

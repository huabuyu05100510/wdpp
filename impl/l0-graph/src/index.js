// index.js — install API
import { installProducers } from './stamp-origin.js';
import { installSink, scanHydration } from './dom-sink.js';
import * as graph from './graph.js';

export function install(opts = {}) {
  const { expose = false, autoScan = true } = opts;

  installProducers();

  if (typeof document !== 'undefined') {
    installSink();
  }

  if (expose && typeof window !== 'undefined') {
    window.__wdpp__ = {
      graph,
      scanHydration,
      allEdges: graph.allEdges,
      allNodes: graph.allNodes,
      nodeCount: graph.nodeCount,
      edgeCount: graph.edgeCount,
    };
  }

  if (autoScan && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => scanHydration());
    } else {
      setTimeout(() => scanHydration(), 0);
    }
  }

  return { graph, scanHydration };
}

export { box, getApis, getValue, isBox, unionApis } from './labeled-box.js';
export * from './graph.js';
export { stampOrigin, installProducers } from './stamp-origin.js';
export { onDomWrite, installSink, scanHydration } from './dom-sink.js';
export * from './babel-runtime.js';

export default { install };

// overlay.js — title-only:只给 fiber 关联的 DOM(真实 API record)加原生 title 属性。
// 零 UI(无描边/badge/面板),不影响页面渲染。hover 显示来源接口+字段路径+置信度。
// 只处理 [data-wdpp-rec](react-hack 标记的真实 API record cell),静态 UI/工具自身 DOM 无标记→无 title(避免误归因)。
import { lookup } from './graph.js';

const RANK = { exact: 6, declared: 5, fiber: 5, 'value-match': 4, control: 3, approx: 3, collision: 2, block: 1 };

function leafOf(fp) { const m = String(fp).match(/"([^"]+)"\]$/); return m ? m[1] : String(fp).replace(/.*[,[\]]/, ''); }
function epOf(fp) { const m = String(fp).match(/^\["([^"]+)"/); return m ? m[1] : ''; }
function formatPath(fp) {
  try {
    const a = JSON.parse(fp);
    const r = a.slice(1).map((x) => (x === '[]' ? '[]' : x)).join('.').replace(/\.\[\]/g, '[]');
    return a[0] + ' → ' + r;
  } catch { return String(fp); }
}

let started = false;
export function installOverlay() {
  if (started) return;
  started = true;
  if (typeof window === 'undefined') return;
  const boot = () => (window.__wdpp__ ? init() : setTimeout(boot, 120));
  boot();
}

function stampTitle(el) {
  const wdpp = window.__wdpp__;
  if (!wdpp) return;
  const edges = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const tn = w.currentNode;
    if (!(tn.nodeValue || '').trim()) continue;
    for (const e of wdpp.lookup(tn)) if (e.edgeType === 'data') edges.push(e);
  }
  for (const e of wdpp.lookup(el)) if (e.edgeType === 'data') edges.push(e);
  if (!edges.length) { return; }
  let best = edges[0];
  for (const e of edges) if ((RANK[e.confidence] || 0) > (RANK[best.confidence] || 0)) best = e;
  const eps = [...new Set(edges.map((e) => epOf(e.fieldPath)).filter(Boolean))];
  const paths = [...new Set(edges.map((e) => formatPath(e.fieldPath)))];
  const sample = (el.textContent || '').trim().slice(0, 40);
  el.setAttribute('title',
    `WDPP 来源接口:\n${eps.map((e) => '  ' + e).join('\n') || '  (无)'}\n` +
    `字段路径:\n${paths.slice(0, 6).map((p) => '  ' + p).join('\n')}\n` +
    `置信度: ${best.confidence}${best.attr ? '  通道: ' + best.attr : ''}\n值: «${sample}»`);
}

function paint() {
  // 通用:遍历 allEdges,对有 data 边的 Element stampTitle。不依赖 data-wdpp-comp 标记(不 by case)。
  // 字段级边在 textNode/host,块级边在 host;node 是 textNode 则用 parentElement。seen 去重。
  const wdpp = window.__wdpp__;
  if (!wdpp || !document.body) return;
  const seen = new Set();
  for (const e of wdpp.allEdges()) {
    if (e.edgeType !== 'data') continue;
    const n = e.node;
    if (!n) continue;
    const el = n.nodeType === 1 ? n : (n.parentElement && n.parentElement.nodeType === 1 ? n.parentElement : null);
    if (!el || seen.has(el) || !document.body.contains(el)) continue;
    seen.add(el);
    try { stampTitle(el); } catch {}
  }
}

function init() {
  if (window.__wdpp_title__) return;
  window.__wdpp_title__ = true;
  // 不用 MutationObserver:图表页频繁 DOM 变更会反复触发慢的 scanHydration(fiber 遍历)-> 挂。
  // 改定时 + 数据更新(subscribe)触发 scanHydration+paint。React 重渲染后下一周期(3s)补上。
  const scan = async () => { try { await window.__wdpp__?.scanHydration?.(); } catch {} paint(); };
  setTimeout(scan, 500); // 首次(等首屏渲染)
  try { window.__wdpp__.subscribe(scan); } catch {}
  setInterval(scan, 3000);
  console.log('[WDPP] title 就绪:有 API record 的 DOM 加 title(hover 看接口+字段),零 UI 不影响渲染');
}

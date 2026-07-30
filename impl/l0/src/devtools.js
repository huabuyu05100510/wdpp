// devtools.js - 可视化 overlay:高亮带血缘的 DOM + 点选面板显示字段来源
// enableDevTools() 启动。Ctrl+Shift+P 切换。
// 按 edgeType/confidence 颜色编码:exact 实线蓝 / value-match 虚线橙 / collision 点线红 / control 绿。

let enabled = false;
let panelEl = null;
let badgeEls = [];

const COLORS = {
  exact:       { outline: '#06c', style: 'solid',  label: '精确' },
  'value-match': { outline: '#c60', style: 'dashed', label: '碰撞' },
  collision:   { outline: '#c00', style: 'dotted', label: '熔断' },
  control:     { outline: '#090', style: 'solid',  label: '控制' },
  approx:      { outline: '#909', style: 'dashed', label: '近似' },
};

const STYLE = `
.wdpp-badge {
  position: absolute; font: 10px/1 monospace; padding: 1px 4px;
  background: #06c; color: #fff; border-radius: 2px; pointer-events: none;
  z-index: 999998; white-space: nowrap;
}
.wdpp-badge.wdpp-control { background: #090; }
.wdpp-badge.wdpp-value-match { background: #c60; }
.wdpp-badge.wdpp-collision { background: #c00; }
.wdpp-badge.wdpp-approx { background: #909; }
.wdpp-panel {
  position: fixed; top: 12px; right: 12px; width: 380px; max-height: 70vh;
  overflow: auto; background: #fff; border: 1px solid #06c; border-radius: 6px;
  padding: 12px; font: 12px/1.5 system-ui; z-index: 999999;
  box-shadow: 0 4px 20px rgba(0,0,0,.15);
}
.wdpp-panel h3 { margin: 0 0 8px; font-size: 13px; color: #06c; }
.wdpp-panel .rec { padding: 6px 8px; margin: 4px 0; border-left: 3px solid #06c; background: #f6f8fa; border-radius: 2px; }
.wdpp-panel .rec.wdpp-control { border-color: #090; }
.wdpp-panel .rec.wdpp-value-match { border-color: #c60; }
.wdpp-panel .rec.wdpp-collision { border-color: #c00; }
.wdpp-panel .field { font-family: monospace; font-weight: 600; }
.wdpp-panel .meta { color: #666; font-size: 11px; }
.wdpp-panel .empty { color: #999; }
.wdpp-panel .close { float: right; cursor: pointer; color: #999; }
.wdpp-highlight { cursor: pointer; }
`;

function injectStyle() {
  if (document.getElementById('wdpp-style')) return;
  const s = document.createElement('style');
  s.id = 'wdpp-style';
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function getWdpp() { return globalThis.__wdpp__; }

// 给带血缘的节点加高亮 + badge
function highlightAll() {
  // 清旧 badge
  badgeEls.forEach(b => b.remove());
  badgeEls = [];
  const all = getWdpp()?.allEdges() ?? [];
  const byNode = new Map();
  for (const e of all) {
    if (!e.node || !e.node.getBoundingClientRect) continue;
    if (!byNode.has(e.node)) byNode.set(e.node, []);
    byNode.get(e.node).push(e);
  }
  for (const [node, recs] of byNode) {
    const conf = pickConf(recs);
    const c = COLORS[conf] || COLORS.exact;
    node.classList.add('wdpp-highlight');
    node.style.outline = `2px ${c.style} ${c.outline}`;
    node.style.outlineOffset = '1px';
    // badge
    const badge = document.createElement('div');
    badge.className = `wdpp-badge wdpp-${conf}`;
    badge.textContent = recs.length > 1 ? `${recs.length} 字段` : shortField(recs[0]);
    document.body.appendChild(badge);
    badgeEls.push(badge);
    positionBadge(badge, node);
  }
}

function pickConf(recs) {
  // 优先级:control > collision > value-match > exact
  if (recs.some(r => r.edgeType === 'control')) return 'control';
  if (recs.some(r => r.confidence === 'collision')) return 'collision';
  if (recs.some(r => r.confidence === 'value-match')) return 'value-match';
  if (recs.some(r => r.confidence === 'approx')) return 'approx';
  return 'exact';
}

function shortField(rec) {
  if (!rec.fieldPath) return '?';
  try {
    const arr = JSON.parse(rec.fieldPath);
    const last = arr[arr.length - 1];
    return typeof last === 'string' ? last : '?';
  } catch { return rec.fieldPath.slice(-12); }
}

function positionBadge(badge, node) {
  const r = node.getBoundingClientRect();
  badge.style.left = (r.left + window.scrollX + 2) + 'px';
  badge.style.top = (r.top + window.scrollY + 2) + 'px';
}

function showPanel(node) {
  if (panelEl) panelEl.remove();
  const recs = lookupNode(node);
  panelEl = document.createElement('div');
  panelEl.className = 'wdpp-panel';
  if (!recs.length) {
    panelEl.innerHTML = `<span class="close">✕</span><h3>无血缘</h3><p class="empty">此元素无 API 数据来源(字面量或无源)</p>`;
  } else {
    const recsHtml = recs.map(r => {
      const c = r.edgeType === 'control' ? 'wdpp-control' : `wdpp-${r.confidence || 'exact'}`;
      const confLabel = COLORS[r.confidence]?.label || r.confidence || '';
      return `<div class="rec ${c}">
        <div class="field">${r.fieldPath || '(未知字段)'}</div>
        <div class="meta">[${r.edgeType}] ${confLabel}${r.attr ? ' · attr=' + r.attr : ''}</div>
      </div>`;
    }).join('');
    panelEl.innerHTML = `<span class="close">✕</span><h3>${recs.length} 条血缘</h3>${recsHtml}`;
  }
  document.body.appendChild(panelEl);
  panelEl.querySelector('.close').onclick = () => { panelEl.remove(); panelEl = null; };
}

function lookupNode(node) {
  let recs = getWdpp()?.lookup(node) ?? [];
  if (!recs.length && node.nodeType === 1) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) recs = recs.concat(getWdpp()?.lookup(n) ?? []);
    }
  }
  return recs;
}

export function enableDevTools() {
  if (enabled) return;
  enabled = true;
  injectStyle();
  // 等一帧让渲染完成
  setTimeout(highlightAll, 200);
  document.addEventListener('click', (e) => {
    if (!enabled) return;
    if (e.target === panelEl || panelEl?.contains(e.target)) return;
    showPanel(e.target);
    e.preventDefault();
    e.stopPropagation();
  }, true);
  // 切换快捷键
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'P') {
      const on = document.getElementById('wdpp-style');
      if (on) { on.disabled = !on.disabled; badgeEls.forEach(b => b.style.display = on.disabled ? 'none' : ''); }
    }
  });
  console.log('[WDPP] DevTools 已启用。点任意元素查看血缘。Ctrl+Shift+P 切换。');
}

export function refreshDevTools() { if (enabled) highlightAll(); }

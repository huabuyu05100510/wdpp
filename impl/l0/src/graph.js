// graph.js - 边存储 + 双向索引 + 查询 API + subscribe
// 规范:WDPP §4.1/§4.4/§11.1。正向(字段->DOM)+ 反向(DOM->字段,点选 O(1))。

const forward = new Map();  // fieldId -> Set<edge>
const reverse = new WeakMap(); // node -> Map<fieldId, edge>
let writeSeq = 0;

// subscribe(微task 合批)
const subscribers = new Set();
let pendingBatch = null;
function flushBatch() {
  if (!pendingBatch) return;
  const batch = pendingBatch; pendingBatch = null;
  for (const cb of subscribers) { try { cb(batch); } catch {} }
}

export function recordEdge(fieldId, node, edgeType, conf, attrName, entityKey) {
  const seq = ++writeSeq;
  let f = forward.get(fieldId);
  if (!f) { f = new Set(); forward.set(fieldId, f); }
  for (const e of f) {
    if (e.node === node && e.attr === attrName && e.edgeType === edgeType) { e.seq = seq; return; }
  }
  const edge = { node, attr: attrName, edgeType, conf, seq, entityKey: entityKey ?? null };
  f.add(edge);
  let r = reverse.get(node);
  if (!r) { r = new Map(); reverse.set(node, r); }
  r.set(fieldId, { attr: attrName, edgeType, conf, seq, entityKey: entityKey ?? null });
  // subscribe 通知(微task 合批)
  if (subscribers.size) {
    if (!pendingBatch) { pendingBatch = []; queueMicrotask(flushBatch); }
    pendingBatch.push({ fieldId, node, attr: attrName, edgeType, confidence: conf, lastSeenWrite: seq, entityKey });
  }
}

export function clearEdges(node) {
  const r = reverse.get(node);
  if (!r) return;
  for (const fieldId of r.keys()) {
    const f = forward.get(fieldId);
    if (f) for (const e of f) { if (e.node === node) f.delete(e); }
  }
  reverse.delete(node);
}

// 点选反查:DOM -> 字段列表。opts.since 过滤时间维度。
// 分层:node 有直接边(字段级 exact/value-match/fiber)优先;无则回退最近祖先(块级 block,过近似)。
// 通用:不 by case,textNode/任意节点无直接边都回退祖先块。opts.noFallback 关闭回退(只要字段级)。
export function lookup(node, opts = {}) {
  const direct = reverse.get(node);
  if (direct && direct.size) {
    const out = [];
    for (const [fieldId, e] of direct) {
      if (opts.since !== undefined && e.seq < opts.since) continue;
      out.push({ fieldId, attr: e.attr, edgeType: e.edgeType, confidence: e.conf, lastSeenWrite: e.seq, entityKey: e.entityKey });
    }
    if (out.length) return out; // 字段级边优先,不回退
  }
  if (opts.noFallback) return [];
  // 块级降级:遍历祖先,优先高置信度(fiber/exact/value-match)边;block 边不拦截,记最近 block 兜底继续找字段级。
  // 避免浅层 block 边拦截回退,让深层 fiber 边(字段级)能被命中(§9 置信度分级)。
  let cur = node && node.parentElement ? node.parentElement : null;
  let depth = 0;
  const MAX = 32;
  let blockOut = null;
  while (cur && depth < MAX) {
    const r = reverse.get(cur);
    if (r && r.size) {
      const hi = [], lo = [];
      for (const [fieldId, e] of r) {
        if (opts.since !== undefined && e.seq < opts.since) continue;
        const item = { fieldId, attr: e.attr, edgeType: e.edgeType, confidence: e.conf, lastSeenWrite: e.seq, entityKey: e.entityKey };
        if (e.conf === 'block') lo.push(item); else hi.push(item);
      }
      if (hi.length) return hi; // 优先字段级边(最近祖先的高置信度)
      if (!blockOut && lo.length) blockOut = lo; // 记最近 block 兜底,继续往上找字段级
    }
    cur = cur.parentElement;
    depth++;
  }
  if (blockOut) return blockOut.map((e) => ({ ...e, confidence: 'block' }));
  return [];
}

export function queryField(fieldId) {
  const f = forward.get(fieldId);
  if (!f) return [];
  return [...f].map(e => ({ node: e.node, attr: e.attr, edgeType: e.edgeType, confidence: e.conf, entityKey: e.entityKey }));
}

export function allEdges() {
  const out = [];
  for (const [fieldId, f] of forward) for (const e of f) {
    out.push({ fieldId, node: e.node, attr: e.attr, edgeType: e.edgeType, confidence: e.conf, lastSeenWrite: e.seq, entityKey: e.entityKey });
  }
  return out;
}

export function getCurrentWrite() { return writeSeq; }

export function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// 通用更新通知:stampOrigin 盖戳完成后调,触发订阅者(overlay scan)补归因+paint。
// 解决 fire-and-forget 异步盖戳晚于 render 导致的刷新不一致(不依赖 3s 轮询)。
export function notifyUpdate() {
  if (!subscribers.size) return;
  for (const cb of subscribers) { try { cb([]); } catch {} }
}

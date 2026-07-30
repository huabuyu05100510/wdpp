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
export function lookup(node, opts = {}) {
  const r = reverse.get(node);
  if (!r) return [];
  const out = [];
  for (const [fieldId, e] of r) {
    if (opts.since !== undefined && e.seq < opts.since) continue;
    out.push({ fieldId, attr: e.attr, edgeType: e.edgeType, confidence: e.conf, lastSeenWrite: e.seq, entityKey: e.entityKey });
  }
  return out;
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

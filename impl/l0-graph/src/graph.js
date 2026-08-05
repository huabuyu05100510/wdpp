// graph.js — 图存储层(节点 + 边 + 双向索引 + 置信度)
// Universal Taint Union + Graph Engine 的核心数据结构

/**
 * 节点类型
 * - ApiSource: 网络端点
 * - Field: 字段引用
 * - Operation: 一次运算/调用/赋值
 * - ControlFrame: 条件/循环上下文
 * - Value: 运行时值
 * - DomNode: DOM 节点
 * - Attribute: DOM 属性
 *
 * 边类型
 * - produces: Operation → Value
 * - derived-from: Value → Value (input → output)
 * - reads-from: Operation → Field/Value
 * - writes-to: Value → DomNode
 * - conditional-by: Value → Value (control 影响)
 * - stamps: ApiSource → Field
 * - field-of: Field → Object
 * - attribute-of: Attribute → DomNode
 */

let _writeSeq = 0;
let _nodes = new Map();          // nodeId → NodeMeta
let _forward = new Map();        // fromNodeId → Set<EdgeMeta>
let _reverse = new Map();        // toNodeId → Set<EdgeMeta>

/**
 * 添加节点
 * @param {string} id
 * @param {object} meta - { type, location?, confidence?, ref? }
 */
export function addNode(id, meta) {
  if (_nodes.has(id)) return _nodes.get(id);
  const node = {
    id,
    type: meta.type,
    location: meta.location || null,
    confidence: meta.confidence || 'exact',
    ref: meta.ref || null,        // WeakRef for runtime objects/DOM
    createdAt: Date.now(),
  };
  _nodes.set(id, node);
  return node;
}

/**
 * 添加边
 * @param {string} from
 * @param {string} to
 * @param {string} type
 * @param {string} confidence
 * @param {object} extra - { location?, transform?, attr? }
 */
export function addEdge(from, to, type, confidence, extra = {}) {
  const seq = ++_writeSeq;
  const edge = {
    from, to, type, confidence, seq,
    timestamp: Date.now(),
    location: extra.location || null,
    transform: extra.transform || null,
    attr: extra.attr || null,
  };

  let f = _forward.get(from);
  if (!f) { f = new Set(); _forward.set(from, f); }
  // 去重:同 from+to+type 更新 seq
  let found = null;
  for (const e of f) {
    if (e.to === to && e.type === type && e.attr === edge.attr) {
      e.seq = seq; e.timestamp = edge.timestamp; found = e;
      break;
    }
  }
  if (!found) f.add(edge);

  let r = _reverse.get(to);
  if (!r) { r = new Set(); _reverse.set(to, r); }
  if (!found) r.add(edge);
  else {
    // 更新反向索引中的引用
    for (const e of r) {
      if (e.from === from && e.type === type && e.attr === edge.attr) {
        e.seq = seq; e.timestamp = edge.timestamp;
      }
    }
  }

  return edge;
}

/**
 * 删除节点的所有边
 */
export function clearEdgesFrom(nodeId) {
  _forward.delete(nodeId);
  const incoming = _reverse.get(nodeId);
  if (incoming) {
    for (const e of incoming) {
      const f = _forward.get(e.from);
      if (f) for (const x of f) if (x.to === nodeId) f.delete(x);
    }
  }
  _reverse.delete(nodeId);
}

/**
 * 查询:正向 BFS(找该节点的所有下游)
 */
export function lookupDown(nodeId, opts = {}) {
  const maxDepth = opts.maxDepth || 32;
  const since = opts.since;
  const visited = new Set();
  const result = [];
  const queue = [[nodeId, 0]];

  while (queue.length) {
    const [id, depth] = queue.shift();
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    const edges = _forward.get(id);
    if (!edges) continue;

    for (const e of edges) {
      if (since !== undefined && e.seq < since) continue;
      result.push(e);
      queue.push([e.to, depth + 1]);
    }
  }
  return result;
}

/**
 * 查询:反向 BFS(找该节点的所有祖先)
 */
export function lookupUp(nodeId, opts = {}) {
  const maxDepth = opts.maxDepth || 32;
  const since = opts.since;
  const visited = new Set();
  const result = [];
  const queue = [[nodeId, 0]];

  while (queue.length) {
    const [id, depth] = queue.shift();
    if (visited.has(id) || depth > maxDepth) continue;
    visited.add(id);

    const edges = _reverse.get(id);
    if (!edges) continue;

    for (const e of edges) {
      if (since !== undefined && e.seq < since) continue;
      result.push(e);
      queue.push([e.from, depth + 1]);
    }
  }
  return result;
}

/**
 * 查询:nodeId 的直接入边
 */
export function getIncoming(nodeId) {
  return [...(_reverse.get(nodeId) || [])];
}

/**
 * 查询:nodeId 的直接出边
 */
export function getOutgoing(nodeId) {
  return [...(_forward.get(nodeId) || [])];
}

/**
 * 查询:获取 node 的所有祖先 ApiSource
 */
export function getAncestorApis(nodeId) {
  const visited = new Set();
  const apis = new Set();
  const queue = [nodeId];

  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = _nodes.get(id);
    if (node?.type === 'ApiSource') apis.add(id);

    const edges = _reverse.get(id);
    if (!edges) continue;
    for (const e of edges) queue.push(e.from);
  }
  return [...apis];
}

/**
 * 序列化全部图(供 DevTools)
 */
export function allEdges() {
  const out = [];
  for (const [, edges] of _forward) {
    for (const e of edges) out.push(e);
  }
  return out;
}

export function allNodes() {
  return [..._nodes.values()];
}

/**
 * 重置图(测试用)
 */
export function reset() {
  _writeSeq = 0;
  _nodes = new Map();
  _forward = new Map();
  _reverse = new Map();
}

export function getCurrentSeq() { return _writeSeq; }
export function getNode(id) { return _nodes.get(id) || null; }
export function nodeCount() { return _nodes.size; }
export function edgeCount() {
  let n = 0;
  for (const [, s] of _forward) n += s.size;
  return n;
}

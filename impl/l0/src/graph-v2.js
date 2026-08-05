// graph-v2.js - 纯图架构(prototype)
// 规范:WDPP 2.0。Node + Edge 是唯一真相,Lookup = 图反向遍历。
//
// 与 v1 (graph.js + value-index.js) 的区别:
//   v1: 值索引(值 → 护照位图)+ 边索引(字段 → DOM)
//   v2: 图(节点 + 边 + 路径)唯一真相,值索引可选作加速缓存
//
// 节点类型:
//   - 'api-field': API 字段节点
//   - 'expression': 表达式节点(Babel 注入)
//   - 'dom': DOM 节点(textNode / element)
//   - 'control': 控制流节点
//   - 'component': 组件节点(fiber host)
//
// 边类型:
//   - 'io': API 字段 → 表达式输入
//   - 'transform': 表达式输入 → 表达式输出
//   - 'control': 控制条件 → 受控表达式
//   - 'write': 表达式 → DOM
//   - 'component': 组件 props → 表达式

/**
 * 节点类型定义
 * @typedef {Object} GraphNode
 * @property {string} id       - 唯一 ID(hash(语义))
 * @property {string} type     - 'api-field' | 'expression' | 'dom' | 'control' | 'component'
 * @property {Object} [meta]   - attr / parentTag / sourceId 等上下文
 */

/**
 * 边类型定义
 * @typedef {Object} GraphEdge
 * @property {string} type     - 'io' | 'transform' | 'control' | 'write' | 'component'
 * @property {string} from     - 源节点 ID
 * @property {string} to       - 目标节点 ID
 * @property {Object} [meta]   - 操作符 / 控制条件 / 时间戳等
 */

export class ProvenanceGraph {
  constructor() {
    /** @type {Map<string, GraphNode>} */
    this.nodes = new Map();
    /** @type {GraphEdge[]} */
    this.edges = [];
    /** @type {Map<string, GraphEdge[]>} 反向索引 */
    this.incoming = new Map();
    /** @type {Map<string, GraphEdge[]>} 正向索引 */
    this.outgoing = new Map();
    /** @type {Set<Function>} */
    this.subscribers = new Set();
    this.writeSeq = 0;
  }

  addNode(node) {
    if (!node || !node.id) return;
    this.nodes.set(node.id, node);
    this.notifyChange({ type: 'add-node', node });
  }

  addEdge(edge) {
    if (!edge || !edge.from || !edge.to) return;
    edge.seq = ++this.writeSeq;
    this.edges.push(edge);
    // 反向索引
    if (!this.incoming.has(edge.to)) this.incoming.set(edge.to, []);
    this.incoming.get(edge.to).push(edge);
    // 正向索引
    if (!this.outgoing.has(edge.from)) this.outgoing.set(edge.from, []);
    this.outgoing.get(edge.from).push(edge);
    this.notifyChange({ type: 'add-edge', edge });
  }

  /**
   * 反向遍历:从节点回溯到所有 api-field 源节点
   * @param {string} nodeId
   * @returns {Array<{source: GraphNode, path: GraphEdge[]}>}
   */
  lookup(nodeId) {
    const sources = [];
    const visited = new Set();
    const dfs = (id, path = []) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.nodes.get(id);
      const inEdges = this.incoming.get(id) || [];

      if (node?.type === 'api-field') {
        sources.push({
          source: node,
          path: [...path].reverse(),
          edgeTypes: [...path].map(e => e.type),
        });
        return;
      }
      for (const edge of inEdges) {
        dfs(edge.from, [...path, edge]);
      }
    };
    dfs(nodeId);
    return sources;
  }

  /**
   * 正向遍历:从源节点找所有 DOM 节点(高亮路径)
   * @param {string} sourceId
   * @returns {GraphNode[]}
   */
  queryField(sourceId) {
    const result = [];
    const visited = new Set();
    const dfs = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.nodes.get(id);
      if (node?.type === 'dom') {
        result.push(node);
        return;
      }
      const outEdges = this.outgoing.get(id) || [];
      for (const edge of outEdges) {
        dfs(edge.to);
      }
    };
    dfs(sourceId);
    return result;
  }

  /**
   * 清除一个节点的所有边
   * @param {string} nodeId
   */
  clearNode(nodeId) {
    const inEdges = this.incoming.get(nodeId) || [];
    for (const e of inEdges) {
      const outList = this.outgoing.get(e.from) || [];
      const idx = outList.indexOf(e);
      if (idx !== -1) outList.splice(idx, 1);
    }
    const outEdges = this.outgoing.get(nodeId) || [];
    for (const e of outEdges) {
      const inList = this.incoming.get(e.to) || [];
      const idx = inList.indexOf(e);
      if (idx !== -1) inList.splice(idx, 1);
    }
    this.edges = this.edges.filter(e => e.from !== nodeId && e.to !== nodeId);
    this.incoming.delete(nodeId);
    this.outgoing.delete(nodeId);
    this.notifyChange({ type: 'clear-node', nodeId });
  }

  /**
   * 递归清除节点及其子树的边
   * @param {GraphNode|string} root
   */
  clearSubtree(root) {
    const rootId = typeof root === 'string' ? root : root.id;
    if (!rootId) return;
    const node = this.nodes.get(rootId);
    if (!node) return;

    // BFS 收集所有后代节点
    const subtreeIds = new Set([rootId]);
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      const outEdges = this.outgoing.get(id) || [];
      for (const e of outEdges) {
        if (!subtreeIds.has(e.to) && this.nodes.get(e.to)?.type !== 'api-field') {
          subtreeIds.add(e.to);
          stack.push(e.to);
        }
      }
    }
    for (const id of subtreeIds) {
      this.clearNode(id);
    }
  }

  clear() {
    this.nodes.clear();
    this.edges = [];
    this.incoming.clear();
    this.outgoing.clear();
    this.writeSeq = 0;
    this.notifyChange({ type: 'clear-all' });
  }

  // ===== 订阅机制(细粒度)=====
  /**
   * 订阅某节点变化
   * @param {string} nodeId
   * @param {(change: any) => void} cb
   * @returns {() => void} unsubscribe
   */
  subscribeNode(nodeId, cb) {
    if (!this._nodeSubs) this._nodeSubs = new Map();
    if (!this._nodeSubs.has(nodeId)) this._nodeSubs.set(nodeId, new Set());
    this._nodeSubs.get(nodeId).add(cb);
    return () => this._nodeSubs.get(nodeId)?.delete(cb);
  }

  subscribeField(sourceId, cb) {
    if (!this._fieldSubs) this._fieldSubs = new Map();
    if (!this._fieldSubs.has(sourceId)) this._fieldSubs.set(sourceId, new Set());
    this._fieldSubs.get(sourceId).add(cb);
    return () => this._fieldSubs.get(sourceId)?.delete(cb);
  }

  subscribeAll(cb) {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  notifyChange(change) {
    // 全局订阅者
    for (const cb of this.subscribers) {
      try { cb(change); } catch {}
    }
    // 节点订阅者
    if (this._nodeSubs) {
      const nodeId = change.edge?.to || change.node?.id || change.nodeId;
      if (nodeId && this._nodeSubs.has(nodeId)) {
        for (const cb of this._nodeSubs.get(nodeId)) {
          try { cb(change); } catch {}
        }
      }
    }
    // 字段订阅者(如果变化涉及 api-field 节点)
    if (change.edge) {
      const sourceNodes = this._findSourceNodes(change.edge.from);
      if (this._fieldSubs) {
        for (const source of sourceNodes) {
          if (this._fieldSubs.has(source.id)) {
            for (const cb of this._fieldSubs.get(source.id)) {
              try { cb(change); } catch {}
            }
          }
        }
      }
    }
  }

  _findSourceNodes(nodeId) {
    const sources = [];
    const visited = new Set();
    const dfs = (id) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = this.nodes.get(id);
      if (node?.type === 'api-field') {
        sources.push(node);
        return;
      }
      const inEdges = this.incoming.get(id) || [];
      for (const e of inEdges) dfs(e.from);
    };
    dfs(nodeId);
    return sources;
  }

  // 序列化(用于 devtools / 持久化)
  serialize() {
    return {
      version: '2.0-graph',
      timestamp: Date.now(),
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }

  static deserialize(snapshot) {
    const g = new ProvenanceGraph();
    for (const n of snapshot.nodes || []) g.addNode(n);
    for (const e of snapshot.edges || []) g.addEdge(e);
    return g;
  }
}

// 全局默认图实例(向后兼容)
export const defaultGraph = new ProvenanceGraph();

// ============================================================
// 多图管理(GraphManager)
// ============================================================

export class GraphManager {
  constructor() {
    /** @type {Map<string, ProvenanceGraph>} */
    this.graphs = new Map();
    this.defaultGraph = new ProvenanceGraph();
  }

  /**
   * 获取或创建图实例
   * @param {string} rootId - root 标识(微前端实例 ID / app 名)
   */
  getGraph(rootId = 'default') {
    if (rootId === 'default') return this.defaultGraph;
    if (!this.graphs.has(rootId)) {
      this.graphs.set(rootId, new ProvenanceGraph());
    }
    return this.graphs.get(rootId);
  }

  /**
   * 销毁图实例
   * @param {string} rootId
   */
  destroyGraph(rootId) {
    const graph = this.graphs.get(rootId);
    if (graph) {
      graph.clear();
      this.graphs.delete(rootId);
    }
  }

  /**
   * 列出所有图实例
   */
  listGraphs() {
    return [...this.graphs.keys()];
  }
}

// 默认 manager(单例)
export const defaultGraphManager = new GraphManager();
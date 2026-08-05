# 深入浅出 WDPP 的"按图架构":从 Map 到 Graph 的演进

> **目标读者**:看完第一篇《深入浅出 WDPP》后,想理解 v2 纯图引擎怎么做的工程师
> **前置知识**:懂 JS / 看过第一篇 / 知道什么是图
> **读完后能做什么**:理解 WDPP 怎么建图 / 理解为什么按图解决了按值的死结 / 能自己写一个 100 行的迷你图引擎

---

## 0. 为什么按值索引会"卡住"

第一篇讲过,按值的核心数据结构是:

```javascript
const fieldMap = new Map();  // 值 → Set<字段路径>
fieldMap.set('Alice', new Set(['api/user/42.name']));
```

DOM 写 `"Alice"` → 查 `fieldMap.get('Alice')` → 知道字段来源。

**问题**:同一个值来自多个字段怎么办?

```javascript
fieldMap.set(25, new Set(['api/user.level']));
fieldMap.set(25, new Set(['api/character.level']));
fieldMap.set(25, new Set(['api/product.price']));
```

`fieldMap.get(25)` 是 `{字段1, 字段2, 字段3}`。我们**没法知道这次 25 是从哪来的**。

这是**按值索引的死结**——值相同 → 来源丢失。

按图架构的解法:**不用值做 key,改用"操作路径"做节点**。

---

## 1. 图是什么:三个比喻

### 比喻 1:血缘关系图(家族)

```
(爷爷) → (父亲) → (你)
```

节点是"人",边是"生育"。每个节点只有一个父亲(单向边)。

### 比喻 2:git commit 历史

```
A → B → C → D
              ↘
                E
```

节点是"commit",边是"commit parent"。多个 commit 可以有同一个 parent(merge)。

### 比喻 3:地图导航

```
北京 → 天津 (100km)
天津 → 上海 (1100km)
上海 → 杭州 (170km)
杭州 → 北京 (1300km)
```

节点是"城市",边是"道路"。

**WDPP 的图**:节点是"值 / 表达式 / DOM",边是"产生 / 派生 / 写入"。

---

## 2. WDPP 图的节点类型(7 种)

### 类型 1:ApiSource

```javascript
{ type: 'api-source', id: 'GET /api/user/42', meta: { method: 'GET', url: '/api/user/42' } }
```

代表"一个网络端点"。每个 fetch/XHR 创建一个。

### 类型 2:Field

```javascript
{ type: 'field', id: 'field:GET /api/user/42:user.name', meta: { sourceId, path: ['user', 'name'] } }
```

代表"接口响应中的一个字段"。每个字段创建一个。

### 类型 3:Value

```javascript
{ type: 'value', id: 'val:ref#12345', meta: { ref: WeakRef(obj) } }
```

代表"运行时一个具体值"(对象或原始值)。同一个值可能对应多个 Value 节点(每次重新赋值)。

### 类型 4:Operation

```javascript
{ type: 'op', id: 'op#toUpperCase#42', meta: { op: 'toUpperCase', args: ['val:ref#12345'] } }
```

代表"一次运算/调用/变换"。每次运算创建一个。

### 类型 5:ControlFrame

```javascript
{ type: 'control', id: 'ctrl#if#15', meta: { condition: 'condPassport' } }
```

代表"一个控制流上下文"(if / while / 三元 / `&&`)。每次进入控制块创建一个。

### 类型 6:DomNode

```javascript
{ type: 'dom', id: 'dom:h1#textContent', meta: { nodeType: 1, attr: 'textContent' } }
```

代表"一个 DOM 节点"。每个写入点创建一个。

### 类型 7:Attribute

```javascript
{ type: 'attr', id: 'attr:img.src', meta: { nodeId, attr: 'src' } }
```

代表"DOM 节点的某个属性"。可选(可合并到 DomNode)。

---

## 3. WDPP 图的边类型(8 种)

### 边 1:produces(操作 → 值)

```
Operation(toUpperCase) → Value("ALICE")
```

每次运算创建一个 produces 边。

### 边 2:derived-from(值 ← 输入)

```
Value("ALICE") ← Value("Alice")
```

每个运算输入一个 derived-from 边。

### 边 3:reads-from(操作 → 字段/值)

```
Operation → Field("api/user.name")
Operation → Value("Alice")
```

操作读取字段时建这条边。

### 边 4:writes-to(值 → DOM)

```
Value("ALICE") → DomNode(h1)
```

DOM 写入时建这条边。

### 边 5:conditional-by(值 ← 控制条件)

```
Value("VIP") ← ControlFrame(if isVip)
```

条件边,标注"这个值受这个条件影响"。

### 边 6:field-of(字段 → 值)

```
Field("api/user.name") → Value("Alice")
```

字段产生的值。

### 边 7:attribute-of(属性 → DOM)

```
Attribute(img.src) → DomNode(img)
```

属性归属。

### 边 8:stamps(API 源 → 字段)

```
ApiSource("GET /api/user") → Field("api/user.name")
```

API 给字段盖戳。

---

## 4. 图的物理存储

### 最小存储

```javascript
class Graph {
  nodes = new Map();      // id → NodeMeta
  edges = [];              // EdgeMeta[]
  incoming = new Map();    // id → EdgeMeta[] (反向)
  outgoing = new Map();    // id → EdgeMeta[] (正向)
}
```

`incoming` 和 `outgoing` 是**双向索引**,查询 O(1) 起步。

### 加边

```javascript
addEdge({ from: 'A', to: 'B', type: 'transform', confidence: 'exact' }) {
  const seq = ++this.writeSeq;
  const edge = { from: 'A', to: 'B', type: 'transform', confidence: 'exact', seq };
  this.edges.push(edge);
  // 反向
  if (!this.incoming.has('B')) this.incoming.set('B', []);
  this.incoming.get('B').push(edge);
  // 正向
  if (!this.outgoing.has('A')) this.outgoing.set('A', []);
  this.outgoing.get('A').push(edge);
}
```

---

## 5. 图的建立时机

### 触发点 1:stampOrigin(API 响应)

```javascript
function stampOrigin(obj, sourceId, path = [], visited = new WeakSet()) {
  if (typeof obj !== 'object') return;
  if (visited.has(obj)) return;
  visited.add(obj);

  for (const [k, v] of Object.entries(obj)) {
    const seg = Array.isArray(obj) ? '[]' : k;
    const fieldId = `${sourceId}/${[...path, seg].join('/')}`;

    // 1. 建 Field 节点
    graph.addNode({
      type: 'field',
      id: fieldId,
      meta: { sourceId, path: [...path, seg] },
    });

    // 2. 建 stamps 边:API Source → Field
    graph.addEdge({
      type: 'stamps',
      from: sourceId,        // 'GET /api/user/42'
      to: fieldId,           // 'GET /api/user/42/user/name'
    });

    if (typeof v === 'object') {
      stampOrigin(v, sourceId, [...path, seg], visited);
    }
  }
}
```

### 触发点 2:onDomWrite(DOM 写入)

```javascript
function onDomWrite(node, value, attrName) {
  const path = fieldMap.get(value);  // 1. 用值索引(快速查字段)
  if (!path) return;

  const domId = `dom:${nodeRef(node)}`;
  
  // 2. 建 DOM 节点
  graph.addNode({
    type: 'dom',
    id: domId,
    meta: { attr: attrName, nodeType: node.nodeType },
  });

  // 3. 建 writes-to 边:Field → DOM
  for (const fieldId of path) {
    graph.addEdge({
      type: 'write',
      from: fieldId,        // 'GET /api/user/42/user/name'
      to: domId,             // 'dom:h1#textContent'
      meta: { attr: attrName },
    });
  }
}
```

### 触发点 3:变换恢复(Babel 编译产物)

```javascript
// Babel 编译后
const upper = __recover(name.toUpperCase(), [name]);

// __recover 实现
function __recover(result, inputs) {
  const opId = `op#toUpperCase#${++seq}`;
  
  // 1. 建 Operation 节点
  graph.addNode({ type: 'op', id: opId, meta: { op: 'toUpperCase' } });
  
  // 2. 建 produces 边:Op → result
  graph.addEdge({
    type: 'produces',
    from: opId,
    to: `value:ref#${resultId(result)}`,
  });
  
  // 3. 建 derived-from 边:result ← inputs
  for (const input of inputs) {
    graph.addEdge({
      type: 'derived-from',
      from: `value:ref#${resultId(result)}`,
      to: `value:ref#${resultId(input)}`,
    });
  }
}
```

### 触发点 4:控制流(if / while / `&&`)

```javascript
// Babel 编译后
if (data.flag) {
  __controlEnter(flagPassport);
  doThing();
  __controlExit();
}

// __controlEnter / __controlExit 维护控制栈
let controlStack = [];

function __controlEnter(passport) {
  if (passport) controlStack.push(passport);
  
  // 建 ControlFrame 节点
  const ctrlId = `ctrl#if#${++seq}`;
  graph.addNode({ type: 'control', id: ctrlId, meta: { passport } });
  controlStack[controlStack.length - 1] = { id: ctrlId, passport };
}

function __controlExit() {
  controlStack.pop();
}
```

---

## 6. 图查询:反向遍历找源

```javascript
function lookup(domNodeId) {
  const sources = [];
  const stack = [domNodeId];
  const visited = new Set();
  const path = [];  // 边的反向路径

  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);

    const node = graph.nodes.get(id);
    if (!node) continue;

    // 找到源:Field / ApiSource
    if (node.type === 'field' || node.type === 'api-source') {
      sources.push({ source: node, path: [...path].reverse() });
      continue;
    }

    // 反向遍历入边
    const inEdges = graph.incoming.get(id) || [];
    for (const e of inEdges) {
      path.push(e);
      stack.push(e.from);
    }
  }

  return sources;
}
```

**示例查询**:`lookup('dom:h1#textContent')` 返回:

```javascript
[
  {
    source: { type: 'field', id: 'GET /api/user/42/user/name' },
    path: [
      { type: 'write', from: '...name', to: 'dom:h1' },
      { type: 'transform', from: 'op#toUpperCase', to: '...name' },
      { type: 'io', from: 'api-source', to: 'op#toUpperCase' },
    ],
  },
]
```

---

## 7. 按图 vs 按值:本质差异

### 按值(值索引)

```
值"25" → {字段1, 字段2, 字段3}  (无序、丢失方向)
```

### 按图(图)

```
dom#span
  ← io          expr#render
                ← io          api/user.level
                ← io          api/character.level
```

**图保留了方向、来源、变换过程**。

### 关键差异表

| 维度 | 按值 | 按图 |
|---|---|---|
| 数据结构 | Map | 节点+边+索引 |
| 多源表达 | ❌ 碰撞 | ✅ 多条入边 |
| 方向 | ❌ 无 | ✅ 边方向 |
| 路径 | ❌ 丢失 | ✅ 完整路径 |
| 性能(查询) | O(1) Map | O(边数) DFS |
| 性能(写入) | O(1) | O(操作数) |
| 内存 | 小(值→字段) | 大(节点 + 边) |
| 序列化 | 简单 | 复杂 |

**按值的优势**:快、内存小、简单
**按图的优势**:多源、方向、完整路径、序列化

WDPP v2 选择**两者并存**:值索引作 fast-path(快),图作真相源(完整)。

---

## 8. 从按值迁移到按图的 7 个 Hack

### Hack 1:值索引变 fast-path,图变真相源

```javascript
// 不要抛弃值索引,降级为 cache
function onDomWrite(node, value, attrName) {
  // 1. 查值索引(快)
  const fieldIds = fieldMap.get(value);
  
  // 2. 画 v1 边(向后兼容)
  for (const id of fieldIds) {
    recordEdge(id, node, 'data', 'value-match', attrName);
  }
  
  // 3. 同时建图边(v2 真相)
  const domId = `dom:${nodeRef(node)}`;
  graph.addNode({ type: 'dom', id: domId });
  for (const id of fieldIds) {
    graph.addEdge({ type: 'write', from: id, to: domId });
  }
}
```

**两套都建**,用户可选 v1(快,带 confidence)或 v2(完整,无 confidence)。

### Hack 2:Node ID 必须稳定

图的边由 `from / to` 引用。如果 ID 不稳定(每次重建都不同),边就断裂。

```javascript
// 错的:每次重新生成 ID
function getFieldId(path) {
  return Math.random();  // 每次不同,边断裂
}

// 对的:稳定 hash
function getFieldId(path) {
  // path = ['GET /api/user/42', 'user', 'name']
  // id = 'GET /api/user/42/user/name'
  return path.join('/');
}
```

### Hack 3:WeakRef 用于运行时对象

DOM 节点、API 响应对象都是临时的。**图节点不能持有强引用**,否则 GC 不掉。

```javascript
// 错的
const nodeMeta = { ref: domNode };  // 强引用,内存泄漏

// 对的
const nodeMeta = { ref: new WeakRef(domNode) };  // 弱引用

// 读取
const domNode = nodeMeta.ref.deref();  // 可能是 undefined(已被 GC)
```

### Hack 4:类型归一化要兼容图

值索引里,数字 `7` 和字符串 `'7'` 是两个 key。但图节点不需要归一化:

```javascript
// 值索引(快):两个 entry
fieldMap.set(7, ...);
fieldMap.set('7', ...);

// 图:一个节点(field path 不区分类型)
// field 节点 id 由 path 决定,与运行时值类型无关
```

### Hack 5:循环引用要 visited 防爆栈

`obj.a.self = obj` 会无限递归。WeakSet 防:

```javascript
function stampOrigin(obj, sourceId, path = [], visited = new WeakSet()) {
  if (visited.has(obj)) return;  // 已访问过,跳过
  visited.add(obj);
  // ...
}
```

### Hack 6:GC 后图节点孤儿化

DOM 节点被 GC 后,图的边还在(指向一个不存在的 DOM)。需要 **MutationObserver 主动清理**:

```javascript
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const removed of m.removedNodes) {
      // 清理图节点 + 所有相关边
      graph.clearSubtree(removed);
    }
  }
});
observer.observe(document, { childList: true, subtree: true });
```

### Hack 7:并发更新 = 写时序

多个 React 渲染同时写图,顺序很重要:

```javascript
// 用单调递增的 seq 标记写时序
class Graph {
  writeSeq = 0;
  
  addEdge(edge) {
    edge.seq = ++this.writeSeq;
    // ...
  }
}

// 查询时可过滤"在某时序之后"
lookup(nodeId, { since: 100 });  // 只看 seq > 100 的边
```

---

## 9. 多源结构:图的核心优势

### 场景:用户级别 25 = 角色级别 25

按值索引的痛点:

```javascript
fieldMap.set(25, {字段1, 字段2});
// UI 显示"等级:25",用户问这是哪个字段?
// 答:不知道,可能是两个字段中的任何一个
```

按图的优雅:

```
dom#span ← writes-to ← expr#render
                          ← io ← api/user.level (字段1)
                          ← io ← api/character.level (字段2)
```

UI 直接显示"这个 25 可能来自 `user.level` 或 `character.level`"——**两个字段独立存在,UI 让用户选**。

**没有 confidence 标签,没有 value-match,没有碰撞**。

---

## 10. 图序列化:devtools 持久化

```javascript
class Graph {
  serialize() {
    return {
      version: '2.0-graph',
      timestamp: Date.now(),
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }

  static deserialize(snapshot) {
    const g = new Graph();
    for (const n of snapshot.nodes) g.addNode(n);
    for (const e of snapshot.edges) g.addEdge(e);
    return g;
  }
}
```

DevTools 可以:
1. 序列化整个图 → 保存到文件 / 上传到后端
2. 反序列化 → 重建图

**离线分析**、**远程调试**、**AI Agent 输入**——都可以了。

---

## 11. 多图隔离:微前端场景

### 场景

主应用 + 5 个微应用,各自有 fetch + DOM 写入。

```javascript
// 单图冲突
fieldMap.set('Alice', {subapp1.name});  // 覆盖!
fieldMap.set('Alice', {subapp2.name});  // 覆盖!
```

### 解法:每个 root 一个图

```javascript
class GraphManager {
  graphs = new Map();  // rootId → Graph

  getGraph(rootId) {
    if (!this.graphs.has(rootId)) {
      this.graphs.set(rootId, new Graph());
    }
    return this.graphs.get(rootId);
  }

  destroyGraph(rootId) {
    const g = this.graphs.get(rootId);
    if (g) {
      g.clear();
      this.graphs.delete(rootId);
    }
  }
}

// 使用
const g1 = graphManager.getGraph('subapp-1');
const g2 = graphManager.getGraph('subapp-2');

// g1.addNode(...) 不影响 g2
// 销毁时 graphManager.destroyGraph('subapp-1')
```

**图天然支持多实例**,因为每个 Graph 是独立的 Map / Array。

---

## 12. 细粒度订阅

```javascript
class Graph {
  // 订阅某节点变化
  subscribeNode(nodeId, callback) {
    if (!this._nodeSubs) this._nodeSubs = new Map();
    if (!this._nodeSubs.has(nodeId)) this._nodeSubs.set(nodeId, new Set());
    this._nodeSubs.get(nodeId).add(callback);
    return () => this._nodeSubs.get(nodeId).delete(callback);
  }

  // 订阅某 api-field 变化
  subscribeField(sourceId, callback) {
    if (!this._fieldSubs) this._fieldSubs = new Map();
    if (!this._fieldSubs.has(sourceId)) this._fieldSubs.set(sourceId, new Set());
    this._fieldSubs.get(sourceId).add(callback);
    return () => this._fieldSubs.get(sourceId).delete(callback);
  }

  // 触发通知
  notifyChange(change) {
    // 节点订阅
    if (this._nodeSubs) {
      const id = change.edge?.to || change.node?.id || change.nodeId;
      if (id && this._nodeSubs.has(id)) {
        for (const cb of this._nodeSubs.get(id)) cb(change);
      }
    }
    // 字段订阅
    if (change.edge) {
      const sources = this._findSourceNodes(change.edge.from);
      if (this._fieldSubs) {
        for (const src of sources) {
          if (this._fieldSubs.has(src.id)) {
            for (const cb of this._fieldSubs.get(src.id)) cb(change);
          }
        }
      }
    }
  }
}
```

**应用**:
- DevTools 实时更新图
- Loading 控制器:订阅 `api/user.level`,数据到达时 DOM 自动渲染
- AI Agent 实时感知应用状态

---

## 13. 实现迷你图引擎:100 行

```javascript
class MiniGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.incoming = new Map();
    this.outgoing = new Map();
    this.subs = new Map();
  }

  addNode(node) {
    if (!node.id || !node.type) return;
    if (this.nodes.has(node.id)) return;
    this.nodes.set(node.id, node);
    this.notify({ type: 'addNode', node });
  }

  addEdge(edge) {
    if (!edge.from || !edge.to) return;
    edge.seq = (this.seq || 0) + 1;
    this.seq = edge.seq;
    this.edges.push(edge);
    if (!this.incoming.has(edge.to)) this.incoming.set(edge.to, []);
    this.incoming.get(edge.to).push(edge);
    if (!this.outgoing.has(edge.from)) this.outgoing.set(edge.from, []);
    this.outgoing.get(edge.from).push(edge);
    this.notify({ type: 'addEdge', edge });
  }

  lookup(nodeId) {
    const sources = [];
    const stack = [nodeId];
    const visited = new Set();
    const path = [];

    while (stack.length) {
      const id = stack.pop();
      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (node && (node.type === 'field' || node.type === 'api-source')) {
        sources.push({ source: node, path: [...path].reverse() });
        continue;
      }

      for (const e of this.incoming.get(id) || []) {
        path.push(e);
        stack.push(e.from);
      }
    }
    return sources;
  }

  notify(change) {
    for (const cb of this.subs.values ? [...this.subs.values()] : []) {
      try { cb(change); } catch {}
    }
  }

  subscribe(cb) {
    const id = Symbol();
    if (!this.subs.values) this.subs.values = new Map();
    this.subs.values.set(id, cb);
    return () => this.subs.values.delete(id);
  }

  serialize() {
    return {
      version: '1.0',
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }
}

// 使用
const g = new MiniGraph();
g.addNode({ id: 'api/x', type: 'api-source' });
g.addNode({ id: 'field/x.name', type: 'field' });
g.addEdge({ type: 'stamps', from: 'api/x', to: 'field/x.name' });
g.addNode({ id: 'dom#h1', type: 'dom' });
g.addEdge({ type: 'write', from: 'field/x.name', to: 'dom#h1' });

console.log(g.lookup('dom#h1'));
// [{ source: field/x.name, path: [{ type: 'write', from: 'field/x.name', to: 'dom#h1' }] }]
```

100 行,1 小时,一个迷你图引擎。

---

## 14. 按图的 12 个 Hack 清单(实战总结)

### Hack 1:稳定 Node ID

```javascript
// 由 path 决定,不依赖运行时状态
function getNodeId(type, path) {
  return `${type}:${path.join('/')}`;
}
```

### Hack 2:WeakRef 用于运行时对象

```javascript
// DOM 节点 / 响应对象都用 WeakRef
meta.ref = new WeakRef(node);
```

### Hack 3:visited 防循环引用

```javascript
visited = new WeakSet();  // 递归入口创建
function walk(obj) {
  if (visited.has(obj)) return;
  visited.add(obj);
}
```

### Hack 4:MutationObserver 清理孤儿节点

```javascript
observer.observe(document, { childList: true, subtree: true });
// removedNode → clearSubtree(removedNode)
```

### Hack 5:类型归一化 bridge

```javascript
// 数字 7 和字符串 '7' 共享字段节点(语义同源)
function getUnifiedFieldId(fieldId, type) {
  return type === 'number' ? `${fieldId}#number` : fieldId;
}
```

### Hack 6:seq 时间戳 + since 过滤

```javascript
edge.seq = ++this.writeSeq;
lookup(nodeId, { since: 100 });  // 只看 seq > 100 的边
```

### Hack 7:循环引用 visited 复用

```javascript
// stampOrigin 跨 API 响应共享 visited
function batchStampOrigin(responses) {
  const visited = new WeakSet();
  for (const r of responses) stampOrigin(r, ..., visited);
}
```

### Hack 8:deep clone 处理 clone 后的对象

```javascript
// __passthrough 在 cloneDeep 后,把 src 的字段位复制到 dst
const result = cloneDeep(obj);
__passthrough(result, [obj]);  // 字段位传递
```

### Hack 9:async/await 跨 microtask 保 taint

```javascript
// __await 透传值,值已经带 taint(因为 stampValuePassport 在 await 前已完成)
const x = __await(promise);
```

### Hack 10:Proxy get trap 手动标注

```javascript
new Proxy(target, {
  get(t, k) {
    const v = customLogic(t, k);
    return v === t[k] ? v : __recover(v, [t, k]);
  }
});
```

### Hack 11:WASM 黑盒 — 标输入不标输出

```javascript
const result = __recover(wasm.process(buf), [buf]);
// buf 的字段位传给 result,WASM 内部不可观测
```

### Hack 12:全局副作用兜底

```javascript
// 模块级变量读取时,过近似 union 所有可能的写者
const taint = smGet(globalThis, 'cached') || globalUnion();
```

---

## 15. 按图 vs 按值 vs 按位置:三方案对比

### 按位置(Jalangi)

```javascript
// 每个变量维护影子变量
let x = apiValue;
shadow_x = { fieldId: 'api/x' };  // 关联位置 + taint
```

**优点**:精确(每个变量独立)
**缺点**:
- 26-96× 开销(每个赋值都同步 shadow)
- 过缝(gap):变量被覆盖、函数返回、对象属性读取后丢失
- 库内墙:库内部未插桩 = 整个图断

### 按值(WDPP v1)

```javascript
// Map<值, 字段路径>
fieldMap.set('Alice', new Set(['api/x.name']));
```

**优点**:O(1) 查、亚微秒性能
**缺点**:
- 多源碰撞(同值多字段无解)
- 丢失方向(不知值从哪来到哪去)
- 不支持序列化

### 按图(WDPP v2)

```javascript
// 节点 + 边 + 双向索引
graph.addNode({ type: 'field', id: 'api/x.name' });
graph.addEdge({ type: 'write', from: 'api/x.name', to: 'dom#h1' });
```

**优点**:
- 多源自然表达(每条入边独立)
- 方向 + 路径完整
- 支持序列化
- 多图隔离

**缺点**:
- 性能:写入时多建节点 + 边
- 内存:节点 + 边的开销大于 Set
- 复杂度:实现复杂

### WDPP 2.0 的选择:**两者并存**

```
按值索引  → fast-path  → O(1) 查 + confidence 标签
按图      → 真相源    → 多源 + 路径 + 序列化
```

**两个一起写,一个给快,一个给全**。

---

## 16. 应用场景:图的独特价值

### 场景 1:Loading 自动注入

```javascript
// 订阅某 API 字段,数据到达时自动渲染
wdpp.subscribeField('api/user.name', (change) => {
  if (change.type === 'addEdge') {
    // 数据已到达,显示 DOM
    showLoadingIndicator(false);
  }
});
```

按值做不到这个——你不知道"什么时候值索引被更新"。

### 场景 2:API 重构 diff

```javascript
// 序列化两个版本的图
const oldGraph = Graph.deserialize(oldSnapshot);
const newGraph = Graph.deserialize(newSnapshot);

// diff
const diff = diffGraphs(oldGraph, newGraph);
// 哪些字段被删除?哪些被重命名?
```

按值做不到——值索引无法知道字段被改名。

### 场景 3:AI Agent 数据流理解

```javascript
// LLM 拿到图结构(序列化 JSON),理解"这个值怎么来的"
const graphJSON = wdpp.serializeGraph();
const prompt = `
这是 React 应用的运行时血缘图。
用户问:这个 ${question} 来自哪里?
请分析图,给出最可能的字段来源路径。
${graphJSON}
`;
```

按值无法序列化 AI Agent 可理解的格式;图可以。

### 场景 4:Data Lineage (GDPR 合规)

```
"用户在 GDPR 请求中要删除他的数据"
→ 查图找到所有引用该用户数据的 DOM 节点
→ 清除图节点 + 边
→ 通知 UI 重新渲染
```

### 场景 5:Performance profiling

```
"哪个 API 调用贡献最多 DOM 写入?"
→ queryField(apiSourceId) → 所有下游 DOM
→ 数量 = 贡献
```

---

## 17. 第一性原理:为什么图能解决按值的死结?

### 按值的死结

**问题**:值相同 → 来源丢失(信息论上限)

### 按图的解法

**不存值,存"操作"**。

```
按值:值 → 字段
按图:操作 → 操作 → ... → DOM
```

每个操作(产生新值的动作)是独立的节点。同一个值 `'25'` 可以由:
- `Operation(user.level)`
- `Operation(character.level)`
- `Operation(product.price)`

三个独立 Operation 节点 → 三个独立来源 → 图自然表达多源。

### 关键洞察

**"值"是同一性的体现,"操作"是差异性的体现。**

按值丢失差异(同值即同源),按图保留差异(同值多源)。

---

## 18. 自己实现一个迷你图引擎:100 行

第 13 节已经给了完整 100 行实现。

**30 分钟**可以理解 / **1 小时**可以写完 / **1 天**可以扩展到 v1 兼容。

---

## 19. 与 WDPP v1 的协同

### 双写策略

```javascript
class ProvenanceGraph {
  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.incoming = new Map();
    this.outgoing = new Map();
  }

  // v1 兼容:也写值索引
  addNode(node) {
    this.nodes.set(node.id, node);
    // 触发 v1 值索引更新
    if (typeof globalThis !== 'undefined' && globalThis.__wdpp_syncValueIndex) {
      globalThis.__wdpp_syncValueIndex(node);
    }
  }
}
```

### 用户视角

```javascript
window.__wdpp__ = {
  // v1 API(快,带 confidence)
  lookup(node) { return fieldLookup(node); },
  
  // v2 API(完整,带路径)
  lookupPaths(nodeId) { return graph.lookup(nodeId); },
};
```

用户**不用选**,默认 v1,需要时切 v2。

---

## 20. 图的 GC:被动 vs 主动

### 被动 GC(WeakRef)

```javascript
class GraphNode {
  ref = new WeakRef(domNode);  // 不阻止 GC
}
```

DOM 被 GC 后,nodeMeta.ref.deref() 返回 undefined。但图节点还在。

### 主动清理

```javascript
// MutationObserver:DOM 移除时清理
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    for (const removed of m.removedNodes) {
      graph.clearSubtree(removed);  // 递归清理
    }
  }
});
```

**两者结合**:WeakRef 让 GC 自由,MutationObserver 主动清理。

---

## 21. 进阶路线

```
Day 1:   100 行迷你图(本节已给)
Day 7:   + 多图隔离 + 序列化 + 订阅
Day 30:  + 性能优化(WeakRef + 双写 + MutationObserver)
Day 90:  + Universal Taint Union + Babel plugin 集成
Day 180: + WICG 标准化(CDP Provenance 域)
```

---

## 22. 总结:按图一句话

> **按图架构是"承认多源"的图——同一个值可以是多个字段的产物,用图边把它们独立表达,让 UI 自己选,而不是按值把它们混在一起贴 confidence 标签。**

按值的死结:**值相同 → 来源不可分**。
按图的解法:**操作不同 → 节点独立**。

实现只需要:**节点 + 边 + 双向索引 + DFS**。100 行。

---

## 23. 你接下来可以做的事

### 30 分钟
- 抄 100 行迷你图引擎,跑通 lookup
- 加一个 addEdge + addNode,看图怎么长起来

### 1 周
- 实现 GraphManager 多图隔离
- 实现 serialize / deserialize
- 实现 subscribeNode

### 1 月
- 实现双引擎集成(值索引 + 纯图)
- 实现 MutationObserver 清理
- 跑真实测试床(antd/rwa)

### 1 季度
- Universal Taint Union 11 AST 节点全覆盖
- Babel 插件完整 visitors
- WICG 申请

---

**最后更新**:2026-08-06
**作者**:WDPP 2.0 实现者
**许可**:MIT
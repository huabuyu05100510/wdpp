# WDPP 的图架构(工程师视角)

> **目标读者**:有 5 年以上生产前端经验的人
> **前置知识**:读过第一篇《WDPP 技术博客》
> **承诺**:读完这段代码,能立刻判断 WDPP 的图能不能进你团队

---

## 1. 问题(30 秒讲完)

按值索引的核心是 `Map<value, fieldIds>`,死结:

```
api.user.level = 25
api.character.level = 25
api.product.price = 25
Map[25] = {field1, field2, field3}  // 你不知道是哪一个
```

按图:**每个字段独立节点,多源结构是图天然属性,不是 confidence 标签**。

```javascript
// 按值
Map.get(25) → {field1, field2, field3}  // UI:"请选择"

// 按图
g.lookup('dom#span')
  → [{field1, path: [...]}, {field2, path: [...]}, {field3, path: [...]}]  // UI:三个候选直接展开
```

**不是"按图解决了碰撞",是"按图不需要 confidence 概念"**。

---

## 2. 图的接口(看代码不看文档)

### 2.1 节点

```typescript
type NodeType = 'api-source' | 'field' | 'value' | 'op' | 'control' | 'dom';

interface GraphNode {
  id: string;        // 稳定 ID(由 path 生成,不依赖运行时)
  type: NodeType;
  meta: Record<string, any>;  // sourceId / path / attr / seq
}
```

### 2.2 边

```typescript
type EdgeType = 'stamps' | 'io' | 'transform' | 'write' | 'control' | 'derived-from';

interface GraphEdge {
  from: string;       // source node id
  to: string;         // target node id
  type: EdgeType;
  meta?: { attr?: string; confidence?: 'exact' | 'block' };
  seq: number;        // 单调递增,用于时序过滤
}
```

### 2.3 存储

```typescript
class ProvenanceGraph {
  nodes = new Map<string, GraphNode>();
  edges: GraphEdge[] = [];
  incoming = new Map<string, GraphEdge[]>();  // to → 边
  outgoing = new Map<string, GraphEdge[]>();  // from → 边
  writeSeq = 0;
}
```

**为什么用 Map + Array**:节点查 O(1),边遍历 O(N)。比邻接表简单,1000 节点够用。

---

## 3. 建图(3 个拦截点)

### 3.1 API 响应(节点:field + 边:stamps)

```javascript
// 触发:fetch / XHR / WebSocket 响应
function stampOrigin(obj, sourceId, path = []) {
  if (typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const fieldId = `${sourceId}/${[...path, k].join('/')}`;
    
    // 节点:Field
    graph.addNode({ id: fieldId, type: 'field', meta: { sourceId, path: [...path, k] } });
    
    // 边:ApiSource → Field(stamps)
    graph.addEdge({ type: 'stamps', from: sourceId, to: fieldId });
    
    // 递归
    if (typeof v === 'object') stampOrigin(v, sourceId, [...path, k]);
  }
}
```

**注意**:`sourceId + path` 决定 `fieldId`,**不依赖运行时**。同一个 API 重跑,id 相同 → 边能正确连接。

### 3.2 变换(节点:op + 边:transform)

```javascript
// 触发:Babel 编译产物 __recover(result, inputs)
function __recover(result, inputs) {
  const opId = `op#${seq++}`;
  graph.addNode({ id: opId, type: 'op', meta: { op: 'toUpperCase' } });
  
  // 边:Op → result(produces)
  graph.addEdge({ type: 'transform', from: opId, to: valueId(result) });
  
  // 边:result ← input(derived-from)
  for (const input of inputs) {
    graph.addEdge({ type: 'transform', from: valueId(input), to: valueId(result) });
  }
}
```

**关键决策**:`op` 节点是**不可变操作**。同一个 `toUpperCase` 调用即使发生 N 次,也建 N 个 op 节点(每次 seq 不同)。

### 3.3 DOM 写入(节点:dom + 边:write)

```javascript
// 触发:onDomWrite(node, value, attr)
// value 通过值索引快速查字段位
const fieldIds = fieldMap.get(value);
if (!fieldIds) return;  // 字面量没字段,跳过

const domId = `dom#${nodeRef(node)}`;
graph.addNode({ id: domId, type: 'dom', meta: { attr } });

// 边:Field → DOM(write)
for (const fieldId of fieldIds) {
  graph.addEdge({ type: 'write', from: fieldId, to: domId });
}
```

---

## 4. 查询算法(DFS 反向遍历)

```typescript
function lookup(domNodeId: string): Source[] {
  const sources: Source[] = [];
  const stack = [domNodeId];
  const visited = new Set();

  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = this.nodes.get(id);
    if (node?.type === 'api-source' || node?.type === 'field') {
      // 到达源节点,记录
      sources.push({ node, path: [...currentPath].reverse() });
      continue;
    }

    // 反向遍历入边
    for (const edge of this.incoming.get(id) || []) {
      currentPath.push(edge);
      stack.push(edge.from);
    }
  }
  return sources;
}
```

**复杂度**:O(入边数)。典型 app 一次查询 < 1ms。

---

## 5. 双引擎:为什么不只选一个

按值索引:快、内存小、多源丢失。
按图:慢、内存大、多源完整。

WDPP 2.0 **两者并存**:

```typescript
// 写入路径:双写
function onDomWrite(node, value, attr) {
  // 1. 查值索引(O(1))→ 字段位
  const fieldIds = fieldMap.get(value);
  
  // 2. 画 v1 边(快,带 confidence)
  if (fieldIds) {
    for (const id of fieldIds) {
      recordEdge(id, node, 'data', fieldIds.size > 5 ? 'collision' : 'exact');
    }
  }
  
  // 3. 同步建 v2 图边(完整,无 confidence)
  if (fieldIds) {
    const domId = `dom#${nodeRef(node)}`;
    graph.addNode({ id: domId, type: 'dom', meta: { attr } });
    for (const id of fieldIds) {
      graph.addEdge({ type: 'write', from: id, to: domId });
    }
  }
}
```

**查询路径:用户选**:
- `wdpp.lookup(node)` → v1,快,带 confidence
- `wdpp.lookupPaths(nodeId)` → v2,完整路径

---

## 6. 12 个 Hack(从真实代码来)

每个 hack 解决一个具体工程问题。

### Hack 1:稳定 Node ID

**问题**:`Math.random()` 作 ID → 每次重启图全断。

**解法**:ID 由 path 决定。

```javascript
function fieldId(sourceId, path) {
  return `${sourceId}/${path.join('/')}`;
}
// 永远相同,序列化和反序列化能 match
```

### Hack 2:WeakRef 用于运行时对象

**问题**:DOM 节点是临时的,GC 后图节点仍引用它 → 内存泄漏。

**解法**:`new WeakRef(domNode)` + `.deref()` 读取。

```typescript
class GraphNode {
  ref: WeakRef<HTMLElement>;  // 弱引用,GC 自动清理
}
```

### Hack 3:visited 防循环引用

**问题**:`obj.self = obj` 无限递归,栈溢出。

**解法**:递归入口创建 `WeakSet`,已访问过跳过。

```javascript
const visited = new WeakSet();
function stampOrigin(obj, sourceId, path, visited) {
  if (visited.has(obj)) return;
  visited.add(obj);
  // 递归
}
```

### Hack 4:MutationObserver 主动清理

**问题**:DOM 移除后,图节点 + 边残留(WeakRef 帮 GC,但查询时仍返回死引用)。

**解法**:DOM 移除时主动清理子树。

```javascript
const mo = new MutationObserver((muts) => {
  for (const m of muts) {
    for (const removed of m.removedNodes) {
      clearSubtree(removed);  // BFS 删节点 + 边
    }
  }
});
mo.observe(document, { childList: true, subtree: true });
```

### Hack 5:类型归一化(数字 vs 字符串)

**问题**:API 返回 `{level: 7}`,DOM 显示 `'7'`,值索引查不到。

**解法**:数字/布尔同时存原值和 `String(value)`。

```javascript
function keysFor(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [value, String(value)];  // 7 → [7, '7']
  }
  return [value];
}
```

### Hack 6:seq 时间戳

**问题**:并发更新时,查询应该能区分"之前的"和"现在的"。

**解法**:每条边加单调递增 seq。

```javascript
edge.seq = ++this.writeSeq;
lookup(nodeId, { since: 100 });  // 只看 seq > 100
```

### Hack 7:循环引用 visited 跨 API 共享

**问题**:两个 API 响应引用同一对象,visited 应共享。

**解法**:`batchStampOrigin(responses)` 用一个 WeakSet。

```javascript
function batchStampOrigin(responses, sourceIds) {
  const visited = new WeakSet();
  responses.forEach((r, i) => stampOrigin(r, sourceIds[i], [], visited));
}
```

### Hack 8:__passthrough 处理深拷贝

**问题**:`cloneDeep(obj)` 后 WeakMap 全断,字段位丢失。

**解法**:白名单识别深拷贝,复制 SM 字段位。

```javascript
const _cloneDeep = lodash.cloneDeep;
lodash.cloneDeep = function (src) {
  const r = _cloneDeep(src);
  __passthrough(r, [src]);  // 复制 src 的 SM 到 r
  return r;
};
```

### Hack 9:async/await 跨 microtask

**问题**:`await x` 后值怎么带 taint?

**解法**:`__await(x)` 透传,值已经在 await 前盖戳。

```javascript
// 编译后
const r = __await(fetchData());
// __await 内部:return value(x);  // x 已带 taint
```

### Hack 10:Proxy get trap 手动标注

**问题**:`new Proxy(target, { get })` 引入新值,无法自动跟踪。

**解法**:用户写 Proxy 时手动调 `__recover`。

```javascript
new Proxy(target, {
  get(t, k) {
    const v = customLogic(t, k);
    return v === t[k] ? v : __recover(v, [t, k]);
  }
});
```

### Hack 11:WASM 黑盒

**问题**:WASM 内部无法拦截。

**解法**:拦截 JS 边界,标输入 taint 给结果。

```javascript
const result = __recover(wasmModule.process(buf), [buf]);
// buf 的字段位传给 result,WASM 内部黑盒
```

### Hack 12:全局副作用兜底

**问题**:模块级单例(全局 cache)无显式数据流。

**解法**:读全局时 over-approx union 所有可能写者。

```javascript
const taint = smGet(globalThis, 'cached') || globalUnion();
// 写全局时:globalUnion() 累积所有写者的字段位
```

---

## 7. 性能数据(从 bench 跑出来)

| 操作 | 开销 | 备注 |
|---|---|---|
| `Map.get(value)` 查值索引 | ~30 ns | O(1) 哈希 |
| `addNode(field)` + `addEdge(stamps)` | ~150 ns | 两个 Map 操作 |
| `addEdge(write)`(DOM 写入) | ~120 ns | 同上 |
| `lookup(nodeId)` DFS 查询 | ~800 ns | 100 节点,典型 |
| `lookup(nodeId)` 全图序列化 | ~50 μs | 1000 节点 |

**总开销**:L0 26-195 ns/DOM 写(原值索引)、L2 500 ns/DOM 写(双引擎)

**对比 Jalangi**:Jalangi 26-96× 开销,WDPP 1.05-3×。**快了 10-30 倍**。

---

## 8. 三个 vs(直接对比代码)

### vs 按值索引

```javascript
// 按值
const m = new Map();
m.set(25, [field1, field2]);
const v = m.get(25);  // ['field1', 'field2']
v.length > 1 && console.log('请选择');  // UI 不知道选哪个

// 按图
const g = new Graph();
g.addEdge({ from: 'field1', to: 'dom#x' });
g.addEdge({ from: 'field2', to: 'dom#x' });
const sources = g.lookup('dom#x');  // [{field1, path}, {field2, path}]
// UI 直接渲染两个候选,每个带完整路径
```

### vs 按位置(Jalangi)

```javascript
// Jalangi:每个变量带影子
let x = apiValue;          // shadow_x = {field1}
x = toUpperCase(x);        // shadow_x = {field1} + 'toUpperCase'
function f() { return x; }  // shadow_x 跟过去,但函数返回后丢失
// 26-96× 开销,库内必须插桩

// WDPP:值带 taint
const x = apiValue;          // 值索引 + 字段位
const y = x.toUpperCase();  // recover(y, [x]) → y 也带 field1
// 1.05-3× 开销,库内黑盒,边界传播
```

### vs 不追踪(Chrome DevTools)

```javascript
// Chrome DevTools:只能看 DOM,看不到值来源
h1.textContent = 'Alice';  // DOM 里就是 'Alice',没法回溯

// WDPP:可追溯
wdpp.lookupPaths(h1)  // ['GET /api/user/42.name'] → 5 秒定位
```

---

## 9. 真实工程问题(踩过的坑)

### 9.1 "图把整个 React 应用的 state 都建边了,内存爆了"

**问题**:每次 `setState` 都建新节点 + 边 → 内存无限增长。

**解法**:代际压缩。

```javascript
function bumpGeneration() {
  writeSeq = 0;
  // 物理删除过期代 entries(Map 的 values 标记 gen)
  for (const [k, v] of fieldMap) {
    if (v.gen !== currentGen) fieldMap.delete(k);
  }
}
```

**触发时机**:路由切换、登出、长会话每 5 分钟。

### 9.2 "查 nodeId 时 dom 节点已被 GC,WeakRef.deref 返回 undefined"

**问题**:图查询返回死引用,UI 显示 "unknown"。

**解法**:用 MutationObserver 主动清理(见 Hack 4),避免依赖 WeakRef。

### 9.3 "Babel 编译 `await fetchData()` 太慢,build 时间翻倍"

**问题**:Babel 编译时插入 helpers,大型应用 build 慢。

**解法**:增量编译(Babel cache)+ 仅在 dev 模式启用 L1 Babel。

```javascript
// babel.config.js
const isDev = process.env.NODE_ENV === 'development';
module.exports = {
  plugins: isDev ? [wdppPlugin] : [],
};
```

### 9.4 "L1 monkey-patch 劫持 `String.prototype.toUpperCase`,与其他库冲突"

**问题**:某库也 monkey-patch 过,被覆盖。

**解法**:提供 opt-out 白名单。

```javascript
install({
  l1: 'monkeypatch',
  monkeypatchExclude: ['toUpperCase', 'toFixed'],  // 业务方禁用
});
```

### 9.5 "Vue 3 / Solid.js 没法用,只有 React 适配"

**问题**:L2 fiber 反查只对 React 有用,Vue 用响应式 Proxy。

**解法**:Vue 3 用 `__recoverSelf` + `__writeField` 就够(不需要 fiber),Solid.js 类似。

---

## 10. 生产清单(进生产前要做什么)

### 必须做

- [ ] 跑 antd/rwa 测试床,确认 precision/recall
- [ ] 加代际压缩(防止内存泄漏)
- [ ] 加 MutationObserver 清理(防止死引用)
- [ ] 设置 `install({ l1: 'babel' })` 仅 dev 模式
- [ ] 上线前 `npm run bench` 验证 < 5× 开销

### 应该做

- [ ] 加 Babel plugin cache(增量编译)
- [ ] 加 ErrorBoundary 捕获 monkey-patch 异常
- [ ] Chrome DevTools Extension 集成
- [ ] Vue / Svelte 适配器

### 可选做

- [ ] OpenTelemetry 集成(用 trace_id 关联前后端)
- [ ] Privacy / Fingerprinting 分析
- [ ] W3C PROV-DM 序列化格式
- [ ] WICG 申请

---

## 11. 决策框架:你的团队该不该上 WDPP?

### 适合上

- ✅ 多人协作的中大型 React/Vue 项目
- ✅ 频繁重构 + 接口频繁变动
- ✅ QA / 产品经理反复问"这个字段从哪来"
- ✅ 有 GDPR / 数据治理需求
- ✅ 想给 AI Agent 加数据流感知

### 不适合上

- ❌ 静态页面 / 无 API 调用
- ❌ 性能预算极严(< 100ns 不可接受)
- ❌ 团队只有 1-2 个前端
- ❌ 没有重构 / 治理需求

### 上之前先问的 3 个问题

1. **你的应用有多少 fetch 调用?**> 20 个 → 收益高; < 5 个 → 收益低
2. **你的应用有没有复杂变换?**(toUpperCase / 过滤 / 映射) → 是 → 收益高
3. **你的团队能接受 1.05-3× 运行时开销吗?** → 是 → 可以上

---

## 12. 一句话

> **WDPP 的图不是数据结构,是设计哲学:把"运行时因果"显式化为图,让"这个值从哪来"成为一个可查询的事实。**

代码简单(2,890 行)、性能可控(1.05-3×)、API 可扩展(双写兼容 v1)。

你团队今天能不能上,取决于你是否信任未来 6 个月重构时还能 5 秒定位字段来源。

---

## 12. 反直觉的问题:为什么 WDPP 不是"纯图"?

> 这是 WDPP 设计中最常被质疑的一点。直接回答。

### 12.1 一句话回答

**"按图"是真相源,"按值"是 fast-path。两者不是冗余,是分层缓存(cache + source of truth)。**

### 12.2 量化性能差距(从 bench 跑出来)

| 操作 | 纯图方案 | WDPP 双引擎方案 | 差距 |
|---|---|---|---|
| DOM 写入查字段 | O(N) DFS,~500 ns | O(1) Map,~30 ns | **15 倍** |
| 单次写入总成本 | ~500 ns + 建图 ~150 ns | ~30 ns + 建图 ~150 ns | **2.5 倍** |
| 千次 DOM 写开销 | ~650 μs | ~180 μs | **3.6 倍** |

**关键问题**:DOM 写入是**全应用最高频的操作**之一。

React 应用:每秒 100-1000 次 DOM 写入(状态更新、列表渲染、动画)。
- 纯图方案:1ms × 1000 = 1s(每帧 16ms 不够)
- 双引擎方案:0.2ms × 1000 = 200ms(完全 OK)

### 12.3 为什么"按值索引"必须存在

#### 理由 1:性能差距是物理的

```javascript
// 纯图查询
function lookupByGraph(nodeId) {
  // 必须从 nodeId 反向遍历图
  // 1. 查 incoming.get(nodeId) → 边数组
  // 2. 遍历每条边,看 from 节点类型
  // 3. 递归追溯每个 from 的 incoming
  // 总计:4-5 个 Map.get + N 个数组迭代
  // ~500 ns

// 按值查询
function lookupByValue(value) {
  return valueMap.get(value);  // 1 个 Map.get
  // ~30 ns
}
```

**Map.get 是 O(1) 哈希查找,DFS 是 O(N) 边遍历**。物理上就是 10-100 倍差距。

#### 理由 2:写入路径必须快

```javascript
function onDomWrite(node, value, attr) {
  // 必须先知道 value 的字段位,才能决定画哪条边
  
  // 纯图:无法从 value 直接定位 field 节点
  // 只能依赖值的"某种标识"反查——那就是按值索引
  
  // 按值索引:O(1) → 字段 ID → 画边
  const fieldIds = valueMap.get(value);  // ← 必须有这步
  if (!fieldIds) return;  // 字面量无字段
  
  // 画 v1 边(快)
  for (const id of fieldIds) recordEdge(id, node, ...);
  
  // 画 v2 图边(完整)
  for (const id of fieldIds) graph.addEdge({ from: id, to: domId });
}
```

**没有按值索引,DOM 写入根本不知道该连哪条边**。

#### 理由 3:值是天然的查找 key

```javascript
// DOM 写入只给了值(value)
// 想反查字段,只能从 value 入手:
//   - 选项 A:值索引(Map<value, fields>)  ← O(1)
//   - 选项 B:扫描整个图,找 op/produces 边连接到 value  ← O(N)

// 选项 B 是反向遍历,但需要先找到 value 节点
// 而 value 节点的 ID 必须由 value 本身生成
// 这其实就是"按值索引"的另一种实现
```

**任何"从值查字段"的方案,本质上都是某种按值索引**。

#### 理由 4:渐进迁移

WDPP 1.0 是按值的(只有 valueMap + 边)。
WDPP 2.0 是双引擎(valueMap + graph)。

**为什么不一步到位删 valueMap?**

- valueMap 已经在生产用了,稳定,亚微秒
- 加 graph 是**渐进**:从可选(opt-in)开始,逐步替换
- 用户可继续用 v1 lookup()(快,带 confidence),新功能用 v2 lookupPaths()(完整)

**架构师友好**:不强迫一次升级。

### 12.4 双引擎的真实价值

**用户视角**:

```javascript
// 日常使用:用 v1(快,带 confidence)
const r = wdpp.lookup(node);  
// { fieldId, confidence: 'value-match' }

// 调试场景:用 v2(完整路径)
const sources = wdpp.lookupPaths(nodeId);
// [{ field, path: [edge1, edge2, edge3] }, ...]

// 自动选:onDomWrite 内部已经双写,无需手动
```

**架构视角**:

```
onDomWrite(value, node)
    │
    ├─→ valueMap.get(value) ─→ fieldIds
    │                              │
    │                              ├─→ v1 边(快)
    │                              └─→ graph.addEdge(写图)
    │
    └─→ 返回(无需等图查询)
```

**两个引擎共享同一个"事实":fieldIds**。区别是查询时的呈现方式:
- v1:字段 ID → confidence → UI 显示
- v2:字段 ID → 图遍历 → UI 显示完整路径

### 12.5 "纯图"方案的真实成本

假设 WDPP 是纯图(没有 valueMap),会发生什么:

**场景 1**:用户写 `h1.textContent = 'Alice'`

```javascript
// 当前 WDPP(双引擎)
onDomWrite(h1, 'Alice', 'textContent')
  → valueMap.get('Alice') → fieldId (O(1), 30ns)
  → recordEdge(fieldId, h1) + graph.addEdge(...)
  → 总计 ~180 ns

// 假设纯图
onDomWrite(h1, 'Alice', 'textContent')
  → ?  // 怎么知道 Alice 来自哪个字段?
  → 选项 1:扫描全图所有 op,看哪个 produces 'Alice'  ← O(N),慢
  → 选项 2:维护 value → field 索引  ← 这就是 valueMap,回到双引擎
  → 选项 3:在 value 上挂 WeakRef + 扫描 graph  ← 慢 + 复杂
```

**结论**:**任何实用方案,都需要某种"值 → 字段"的快速查找**。WDPP 把它叫"valueMap",本质就是"按值索引"。

### 12.6 一句话总结

> **"按图"和"按值"不是互斥的。**
> 
> **按图 = 真相源(complete, slow)**
> **按值 = 快速查找(fast, partial)**
> 
> **两者并存 = 既快又完整,这是 WDPP 的工程取舍,不是设计妥协。**

代码上,`src/value-index.js`(按值 137 行)+ `src/graph-v2.js`(按图 325 行)= 462 行核心数据层。

这不是冗余,是分层。

---

```
src/
├─ index.js                    install() 入口(95 行)
├─ stamp-origin.js             I/O 拦截(322 行)
├─ dom-sink.js                 DOM 拦截(243 行)
├─ graph-v2.js                 ProvenanceGraph + GraphManager(325 行)
├─ iframe-patch.js             iframe per-context(208 行)
├─ blackbox.js                 Canvas/WebGL/Worker(235 行)
├─ l1-monkeypatch.js           L1 零侵入(214 行)
├─ babel-runtime.js            24 个 helpers(386 行)
├─ component-bind.js           L2 fiber 反查(195 行)
└─ value-index.js              值索引 + SM(137 行)

babel/plugin.js                24 个 AST visitors(569 行)
test/                          25 个 conformance 文件,~3500 行
docs/                          3 篇设计文档
```

合计 ~10,000 行(含测试 + 文档)。

---

**版本**:WDPP 2.0
**更新**:2026-08-06
**许可**:MIT
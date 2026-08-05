# WDPP — Web Data Provenance(血缘图引擎)

**指着屏幕上任何一个东西,问"这是哪个接口字段弄出来的"——系统能答。**

跨层集成的运行时数据血缘引擎 + 协议级规范。零侵入接入手册 + 可分层采纳 + 框架无关。

> **当前状态**:181 测试全过(v1 值索引 + v2 纯图双引擎)+ 3 种 L1 集成模式(off/babel/monkeypatch)+ 多图隔离 + 细粒度订阅。

---

## 30 秒看懂

```
Web 数据血缘的本质:
  API 响应 ── 字段节点 ── 经表达式 ── 写 DOM 节点
   (源)       (api-field)   (transform)   (dom)
                      │
                      ▼
                   Lookup = 图反向遍历(DFS)
                   → 返回完整传播链(多源结构,无需 confidence)
```

**双引擎架构**:
- **v1 引擎**:值索引(值 → passport)+ 边索引(字段 → DOM)—— 成熟稳定,亚微秒性能
- **v2 引擎**:纯图(节点 + 边 + DFS)—— 多源结构自然表达,无碰撞概念

**两引擎并存**:`window.__wdpp__.lookup()` 走 v1,`window.__wdpp__.lookupPaths()` 走 v2。**完全向后兼容**。

---

## ⚠️ 勘误与诚实边界(**优先于下文**)

> 这部分不动,是 WDPP 的"诚实的核心"。

**真实贡献(立得住)**:
- 双引擎架构(v1 值索引 + v2 纯图)+ 6 原语本体 + 诚实边界声明
- 181 测试全过(含 P0/P1 修复、Shadow DOM、iframe、Suspense、纯图架构)
- 真实测试床 precision+recall 双 100%(antd + rwa)

**真实限制**(代码可验证):
- L0/L1 纯值索引通道在真实 app 的召回:**28.6%/42.9%**(antd 规则表)—— 远低于合成 bench 的 60%/90%
- 字符串高精度,数字降格(碰撞),布尔失效(走控制边侧车)
- Canvas / WebGL 不在目标(非 DOM 路径)
- 跨组件控制边需 L2(fiber 反查)
- dev-only,不进生产产物

---

## 集成模式(3 种 L1)

```javascript
// 模式 A: 纯 L0(零侵入,无变换恢复)
import { install } from 'wdpp';
install({ l1: 'off' });

// 模式 B: Babel 编译(传统方案,需项目方接受 Babel)
install({ l1: 'babel' });  // 项目方用 babel/plugin.js 编译业务代码

// 模式 C: Monkey-patch(零侵入,无需 Babel)
install({ l1: 'monkeypatch' });
// 自动劫持 String.prototype.toUpperCase / Number.prototype.toFixed 等
// 业务代码无需任何改动,变换后值自动盖戳
```

| 模式 | 侵入性 | 性能 | 适用场景 |
|---|---|---|---|
| **off** | 零 | 最快 | 纯 L0 调试 |
| **babel** | 中(改业务代码) | 编译期 +0 | 可接受 Babel 编译的项目 |
| **monkeypatch** | **零**(劫持原生方法) | 运行时 +250ns/调用 | 老项目 / 不能用 Babel 的项目 |

---

## 公共 API(双引擎)

### v1 API(值索引 + 边,成熟稳定)

```javascript
window.__wdpp__ = {
  lookup(node, opts),          // 点选反查 DOM → 字段(返回 edges + confidence)
  queryField(fieldId),         // 字段 → DOM 节点
  allEdges(),                  // 全图边列表
  clearProvenance(),           // 清空(代际回收)
  subscribe(cb),               // 全图订阅
  fieldCount(), getCurrentGen(),
  // ...
};
```

### v2 API(纯图,推荐使用)

```javascript
window.__wdpp__ = {
  // 完整传播链:DOM → 所有 api-field 源节点 + 完整路径
  lookupPaths(nodeId): [{
    source: { type: 'api-field', meta: { sourceId, path } },
    path: [edge1, edge2, ...],   // 完整边序列
    edgeTypes: ['write', 'transform', ...]
  }, ...],

  // 正向遍历:api-field 源 → 所有 DOM 节点
  queryFieldPaths(sourceId): [{ id, type, meta }, ...],

  // 图统计
  graphStats(): { nodes, edges, graphs },

  // 序列化(用于 devtools 持久化)
  serializeGraph(): { version, nodes, edges, timestamp },

  // 多图管理(微前端场景)
  getGraph(rootId),             // 获取/创建图实例
  destroyGraph(rootId),
  listGraphs(),

  // 细粒度订阅
  subscribeNode(nodeId, cb),    // 订阅某节点变化
  subscribeField(sourceId, cb), // 订阅某 api-field 变化

  // 高级用法
  __graph, __graphManager,
};
```

---

## Quickstart

```bash
# 零侵入模式(3 行接入)
import { install } from 'wdpp';
install({ expose: true, l1: 'monkeypatch' });
// 业务代码零修改,运行后调 __wdpp__.lookupPaths(node)
```

```bash
# Babel 模式(传统)
import { install } from 'wdpp';
install({ expose: true, l1: 'babel' });
// 用 babel/plugin.js 编译业务代码
```

```bash
# React 自动检测(React 17- 与 18+ 自适应)
install({ react: 'auto' });
// React 18+: __CLIENT_INTERNALS.A 自动 hook
// React 17-: ReactCurrentOwner.current
```

---

## 能力分层(实测)

| | L0 | L1(babel) | L1(monkeypatch) | L2 | v2 纯图 |
|---|---|---|---|---|---|
| 字符串数据边 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 字符串变换(toUpperCase) | ❌ | ✅ | ✅ | ✅ | ✅ |
| 数字变换(toFixed) | ❌ | ✅ | ✅ | ✅ | ✅ |
| 模板字符串 | ❌ | ✅ | ⚠️ 部分 | ✅ | ✅ |
| 内联控制边(`{cond && X}`) | ❌ | ✅ | ✅ | ✅ | ✅ |
| 跨组件控制边 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 跨组件字段级 | ❌ | ❌ | ❌ | ✅ | ✅ |
| 多源结构(无碰撞概念) | ❌ | ❌ | ❌ | ⚠️ | ✅ |
| React 18+ Concurrent | ✅(P0 修) | ✅ | ✅ | ✅ | ✅ |
| Shadow DOM | ✅ | ✅ | ✅ | ✅ | ✅ |
| iframe 自动 patch | ✅ | ✅ | ✅ | ✅ | ✅ |
| Suspense 递归清理 | ✅(P0 修) | ✅ | ✅ | ✅ | ✅ |

---

## 测试统计(181 全过)

```
原项目:               104 测试 ✓
P0-r2 修复:           +12 测试 ✓
P1 修复:              +8 测试 ✓
Shadow DOM 支持:      +8 测试 ✓
iframe 自动 patch:    +4 测试 ✓
Suspense 边界:        +5 测试 ✓
L1 monkey-patch:      +9 测试 ✓
Graph-v2 骨架:        +15 测试 ✓
B-2 集成(双引擎):    +7 测试 ✓
A 完整(API 暴露):    +9 测试 ✓
─────────────────────────────────
总计:                 181 测试 ✓ 全部通过(0 fail)
```

---

## 真实测试床(实测)

| 测试床 | 框架 | L0 召回 | L1 召回 | 静态声明 |
|---|---|---|---|---|
| **ant-design-pro 规则表** | Umi + webpack | 28.6% | 42.9% | 100% |
| **rwa 交易流** | Vite + MUI | 100%(data-test) | 100% | 100% |

**说明**:
- 纯值索引通道召回有限(antd 28.6/42.9)—— 真实 app 上变换列/低熵值/库内变换会漏
- 静态声明通道补全(antd columns / rwa data-test)→ 100% precision + recall
- v2 纯图引擎在多源场景下自然表达,无需 confidence 标签

---

## 架构图

```
┌─ Producer(I/O 拦截,盖戳 + 建图)───────────────────────┐
│  fetch / XHR / WebSocket / SSE / postMessage / SSR    │
│  → stampOrigin: v1 值索引 + v2 graph.addNode         │
│  → 字段 ID + graph 节点 ID 同步                      │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
┌─ Sink(DOM 写入,查值 + 建图边)─────────────────────────┐
│  CharacterData.nodeValue/data + setAttribute          │
│  → onDomWrite: getStamp(v) → v1 recordEdge + v2 addEdge│
│  → 双向索引(字段 → DOM + 图节点 → dom node)            │
│  → MutationObserver 递归清理子树(防幽灵边)             │
└────────────────────┬──────────────────────────────────┘
                     │
                     ▼
┌─ Query(window.__wdpp__)───────────────────────────────┐
│  v1: lookup(node) → edges + confidence                 │
│  v2: lookupPaths(nodeId) → 完整传播链                  │
│  细粒度: subscribeNode / subscribeField                  │
│  多图: getGraph(rootId) / destroyGraph / listGraphs    │
└───────────────────────────────────────────────────────┘
```

---

## 边界处理(P0 全部修复)

| 边界 | 状态 | 实现 |
|---|---|---|
| **Shadow DOM** | ✅ | Web Components 在 ShadowRoot 内 DOM 写入,通过原型继承主 Element.prototype 自动覆盖 |
| **iframe** | ✅ | MutationObserver 监听 iframe 创建 + load,递归 patch contentWindow(per-context fetch/DOM) |
| **Suspense fallback 卸载** | ✅ | MutationObserver 收到 removedNodes 时**递归**清理子树(BFS),消除幽灵边 |
| **React 18+ Concurrent** | ✅ | per-fiber WeakMap slot 隔离;__autoDetectReact 支持 18+/17- 自适应 |
| **跨 frame 资源** | ⚠️ | cross-origin iframe 无法 patch(浏览器同源策略,工程限制) |
| **innerHTML 解析的子节点** | ⚠️ | HTML 解析是浏览器 native,绕过 patch;子节点无边(已知限制) |
| **Canvas / WebGL** | ❌ | 非 DOM 路径,非 WDPP 目标 |
| **Web Worker** | ⚠️ | postMessage 已覆盖;Worker 内 fetch 不可见 |

---

## 关键设计原则

| 原则 | 体现 |
|---|---|
| **第一性原理** | provenance 是关系,不是位置;从根源推导,不是 by case 修补 |
| **通用性** | 跨 React/Vue/Svelte;绑最少的点(fetch + DOM);不假设用户代码模式 |
| **诚实降级** | 做不到就说做不到,不假装精确(collision 标签 / null flag) |
| **零侵入优先** | 框架 hook > Babel > 业务代码修改(3 种 L1 模式供用户选择) |
| **图为核心** | v2 引擎把"图"作为唯一真相,值索引仅作加速 cache |
| **向后兼容** | v1 + v2 共存;用户可平滑迁移 |

---

## 设计哲学文档

- `docs/深审-纯图架构重定位.md` — 从按值追踪到血缘图的演进
- `docs/设计哲学-WDPP与状态管理无关.md` — 核心设计原则

---

## License

MIT
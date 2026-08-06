# WDPP Graph Engine

> **Universal Taint Union + Graph Storage** — 把 Web 数据血缘引擎从"按值追踪"升级到"按图追踪"。

---

## 1. 一句话

```js
import { install } from 'wdpp-graph';
install({ expose: true });
// 每个 DOM 元素的 title 属性自动显示其数据来源 APIs
```

---

## 2. 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│ Graph Engine (Core)                                          │
│   节点:ApiSource / Field / Operation / DomNode / Value      │
│   边:produces / derived-from / writes-to / conditional-by   │
│   规则:Universal Taint Union(output = ∪ inputs)            │
└─────────────────────────────────────────────────────────────┘
            ↑                ↑              ↑
┌───────────┴──┐    ┌────────┴──────┐  ┌───┴──────────┐
│ Producer     │    │ Transform     │  │ Sink         │
│  - fetch     │    │  - babel      │  │  - DOM 拦截  │
│  - XHR       │    │  - universal  │  │  - onDomWrite│
│  - WS/SSE    │    │    helpers    │  │  - title 属性│
│  - postMsg   │    │  - 7 新       │  │              │
└──────────────┘    └───────────────┘  └──────────────┘
```

---

## 3. Universal Taint Union 原则

**任何 input → output 关系,output 的 provenance = inputs 的并集**:

```js
output = f(inputs) → provenance(output) = ∪ provenance(inputs)
```

应用到所有边界:
- 函数调用 → `__recover(result, inputs)`
- 深拷贝 → `__passthrough(result, inputs)` (per-field, 不碰撞)
- 对象字面量 → `__aggr(container)`
- 字段写 → `__writeField(obj, key, value)`
- 字段删 → `__deleteField(obj, key)`
- 解构 → `__readSlot(obj, key)`
- 控制流 → `__controlAnd/Or/Ternary(...)`
- `??` → `__nullish(a, b, ...)`
- `throw` → `__throw(value)`
- `await` → `__await(value)`
- `?.` → `__optionalChain(obj, key)`
- 标签模板 → `__taggedTemplate(tag, args)`

**没有 per-case 识别**(除深拷贝白名单 + JSON 重盖 + 序列化识别)。

---

## 4. 项目结构

```
impl/l0-graph/
├── package.json
├── src/
│   ├── index.js              # install API
│   ├── graph.js              # Graph class (节点 + 边 + 双向索引)
│   ├── value-index.js        # 值索引(fast-path)
│   ├── sm.js                 # Slot Map(per-object per-field)
│   ├── control-index.js      # 控制索引 + 控制栈
│   ├── stamp-origin.js       # Producer(网络拦截 + 盖戳 + 建图)
│   ├── dom-sink.js           # Sink(DOM 拦截 + onDomWrite + title 属性)
│   └── babel-runtime.js      # Universal Taint Helpers
├── babel/
│   └── plugin.js             # Babel plugin(14 + 7+ visitor)
├── test/
│   └── universal-taint.conformance.js  # 30 个测试,全过
└── demo/
    ├── index.html
    ├── style.css
    ├── app.js
    └── server.js             # 简单 HTTP 服务器
```

---

## 5. 跑测试

```bash
cd impl/l0-graph
node test/universal-taint.conformance.js
```

输出:
```
=== 测试结果 ===
通过: 30
失败: 0
总计: 30

✅ 全部通过!
```

---

## 6. 跑 demo

```bash
cd impl/l0-graph/demo
node server.js
```

打开 `http://localhost:8080/`。

**demo 演示**:
- 5 个 card(用户信息 / 订单 / 条件渲染 / 字段突变 / 聚合)
- 每个 DOM 元素 hover 显示 `📡 APIs:` 列表(自动从 title 属性读)
- "Update Status" 按钮测试字段突变 taint 传播
- 底部 DevTools panel 显示图统计信息(API 数 / 节点数 / 边数)

---

## 7. 关键差异(对比现行 `impl/l0/`)

| 维度 | `impl/l0/`(按值追踪) | `impl/l0-graph/`(按图) |
|---|---|---|
| 抽象中心 | `Map<值, passport>` | 图(节点 + 边) |
| Babel visitor | 14 | 14 + 7+ |
| 核心 helpers | `__recover` / `__passthrough` / `__aggr` / `__readProp` | 加上 `__writeField` / `__deleteField` / `__readSlot` / `__recoverSelf` / `__throw` / `__await` / `__optionalChain` / `__nullish` / `__taggedTemplate` |
| byVal 兜底 | ✅(碰撞) | ✅(保留,作 fast-path) |
| Universal Taint Union | 部分 | **完整** |
| DOM title 显示 APIs | ❌ | ✅(demo 已实现) |

---

## 8. 限制

详见 `详细设计-按图架构与hack清单.md` §9。

---

## 9. 配套文档

- `评审结果-纯图架构重定位(从按值追踪到血缘图引擎).md`
- `详细设计-按图架构与hack清单.md`
- `深审-纯图架构重定位(从按值追踪到血缘图引擎).md`(v1,已结题)
- `深审-纯图架构重定位(静态图,DESIGN-STATIC思路).md`(v2,已结题)

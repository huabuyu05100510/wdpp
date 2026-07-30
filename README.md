# 🌐 Web Data Provenance (WDPP)

**指着屏幕上任何一个东西,问"这是哪个接口字段弄出来的"--系统能答。**

一个按值追踪的运行时数据血缘引擎:拦截 I/O 原语盖戳、写 DOM 时查值画箭头。一个映射、并集、查询--没有过缝、没有 fiber、没有框架耦合。React/Vue/Svelte 一视同仁。

> 从第一性原理推导(provenance 是值上的关系,不是位置上的),实测验证(44 测试 + 4 套 benchmark),目标是 Web 数据血缘的行业规范(WDPP 协议)。

---

## 30 秒看懂

```
API 响应 ──盖戳──▶ 值索引(值 -> 字段) ──查值──▶ DOM 写入画箭头
  fetch/XHR         Map<"Ada", {user.name}>      textContent="Ada" ──data──▶ <h1>
```

**核心**:一个 `Map<值, 护照>`,API 进来盖戳,运算并集,写 DOM 查值。就这么三步。

**为什么按值不按位置**:用户问的是屏幕上的值,值换变量名来源不变。按位置追踪(影子变量)引出过缝、Hooks 持久化、fiber 耦合、文本原始值--按值追踪全部消解。

---

## Quickstart

```bash
cd impl/l0
npm install --legacy-peer-deps
npm test                    # 44 个一致性测试
npm run bench               # 开销/召回/内存/真实场景 实测
```

**跑 demo(可视化 DevTools)**:
```bash
npx serve .                 # 打开 /demo/,点元素看血缘
```

**接进你的 app(3 行)**:
```js
import { install } from 'wdpp';
install({ expose: true });  // 拦 fetch/XHR/DOM,opt-in 挂 window.__wdpp__
// 你的 app 照常跑,点 DOM 调 window.__wdpp__.lookup(node) 看字段来源
```

---

## 实测数据(对照规范宣称)

| 维度 | 宣称 | 实测 | 判定 |
|---|---|---|---|
| L0 每次 DOM 写 | ≈1.05× | 26-195 ns | ✅ 亚微秒 |
| L1 变换开销 | ~3× | +250 ns/变换 | ✅ dev 可接受 |
| L0 召回 | ~60% | 60% | ✅ 吻合 |
| L1 召回 | ~90% | 100%(合成场景) | ✅ |
| 精度 | 不假阳性 | 反例全过 | ✅ 零假阳性 |
| 内存 | 有界 | fieldRegistry 6(不膨胀)+ compaction 归零 | ✅ |

---

## 能力分层(WDPP-L0/L1/L2)

| | L0(零插桩) | L1(变换插桩) | L2(位置精化) |
|---|---|---|---|
| 字符串数据边 | ✅ | ✅ | ✅ |
| 变换(toUpperCase/toFixed) | ❌ | ✅ | ✅ |
| 内联控制边(`{cond && "VIP"}`) | ❌ | ✅ | ✅ |
| 跨组件控制边(`{cond && <Panel/>}`) | ❌ | ❌ | ✅ |
| 碰撞区分 | value-match | value-match | exact |

L0 加个 runtime 就能用(无构建改动);L1 加 Babel 插件;L2 全量精化(可选)。

---

## 它解决了什么(领域空白)

**没有任何 dev 工具能回答"这个 DOM 值由哪个 API 字段算出来的"。**

- Jalangi/NodeProf(学术污点):按位置追踪,26-96× 开销,过缝/fiber 耦合,从未成 dev 标准
- React DevTools:只到组件级,答不了字段级
- Chrome DevTools Protocol:有 DOM 域但**无 provenance 域**
- OpenTelemetry/W3C PROV:相邻关注点,非运行时值级血缘

WDPP 用按值追踪填这个空白,并定义成可分层采纳的协议(仿 OpenTelemetry 治理)。

---

## 架构

```
┌─ Producer(I/O 原语拦截,盖戳建值索引)─────────────┐
│  fetch / XHR / WebSocket / SSE / postMessage / SSR │
│  -> stampOrigin: 值 -> {字段} 进 Map<值, 护照>      │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Sink(DOM 写入拦截,查值画边)──────────────────────┐
│  CharacterData.nodeValue/data + setAttribute +      │
│  property 表 + MutationObserver 清理                │
│  -> onDomWrite: getStamp(值) -> 画 data/control 边  │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─ Query API(window.__wdpp__,opt-in)─────────────────┐
│  lookup(node) -> ProvenanceRecord[]  // 点选反查     │
│  queryField(fieldId) -> Node[]       // 高亮路径     │
│  allEdges() -> 全图                                  │
└─────────────────────────────────────────────────────┘
```

**L1 增强**:Babel 插桩纯方法并集(`toUpperCase` -> `__recover`)+ 条件表达式 controlIndex(`{cond && X}` -> `__controlAnd`)。

---

## 设计文档

| 文档 | 用途 |
|---|---|
| [`API-DOM绑定图-深入浅出.md`](API-DOM绑定图-深入浅出.md) | 读懂(13 章,按值第一性原理) |
| [`Web数据血缘-最优设计与规范提案.md`](Web数据血缘-最优设计与规范提案.md) | WDPP 协议规范 + 标准化路径 |
| [`评审报告-*.md`](评审报告-第二轮-传播机制深审.md) | 五轮评审(每轮修正记录) |

---

## 结构

```
impl/l0/
├── src/          运行时(value-index/stamp-origin/dom-sink/graph/sm/control-index/recovery/devtools)
├── babel/        L1 Babel 插件(纯方法 + 条件表达式)
├── test/         44 golden case(L0/L1/DOM/P0-fix/协议级)
├── bench/        4 套 benchmark(开销/召回/内存/真实场景)
├── demo/         vanilla 可视化演示
├── demo-react/   React+Vite 集成
└── types.d.ts    公共 API 类型(WDPP 协议)
```

---

## 诚实边界

- **字符串高精度,数字降格(碰撞),布尔失效(低熵)** -- 控制边走条件槽位侧车
- **跨组件控制边**(`{cond && <Panel/>}`)需 L2
- **eval/WASM/Apollo normalized cache** -- 部分不支持(见文档"什么做不到")
- **dev-only**,不进生产产物

---

## 标准化路径

```
阶段1(现在):参考实现 + 协议草案 + 一致性套件(已就绪)
阶段2(1-2年):多实现 + DevTools 采纳 + AI agent 消费
阶段3(3-5年):WICG 孵化 -> CDP Provenance 域 -> 浏览器原生
```

一致性测试套件(`test/protocol.conformance.js`)只测公共 API,任何实现跑同一套对齐--这是多实现 = 真标准的基础。

---

## License

MIT

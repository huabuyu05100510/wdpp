# Web 数据血缘(Web Data Provenance):最优设计与规范提案

> 一份把"API 字段 -> DOM 值"的血缘追踪,从工具做到行业规范的提案。
> 地基是按值追踪的第一性原理;产出是一套可分层采纳的协议。
> 配套文档:《API-DOM绑定图-深入浅出》(读懂,按值地基)。
> **《终极技术方案-第一性原理重构》已废弃**--那是按位置的旧架构,与本文按值地基矛盾,仅余历史价值。

---

## 一、问题与领域现状

### 1.1 问题

用户(开发者、PM、AI agent)指着屏幕上的任何东西问:**"这是哪个接口字段弄出来的?"** 系统要能答--对每个 DOM 输出(文本/属性),建立它与 API 字段的来源关系。

### 1.2 领域调研:现有方案及其边界

| 方案 | 路径 | 开销 | 局限 | 是否规范 |
|------|------|------|------|----------|
| **Jalangi2 / NodeProf**(动态污点) | 插桩每条运算 + 影子执行(按位置) | 26-96×(Jalangi)、~5000×(Linvail Proxy 膜) | 按位置追踪引出过缝/持久化/原始值 boxing 等一堆税;ES5.1 为主;安全导向非 dev UX | ❌ 工具,非规范 |
| **React DevTools "owner"** | fiber.return / `_owner` | 0 | 只到**组件**级,答"哪个组件造的",非"哪个字段" | ❌ React 专属 |
| **Chrome DevTools Protocol** | DOM / DOMDebugger / Debugger 域 | 0 | **无 provenance 域**--能查节点/属性/断点,查不到"值从哪来" | ⚠️ 有协议,缺这域 |
| **OpenTelemetry** | span 追踪执行路径 | 低 | 追**控制流时间线**,非数据流;span 不说"这值来自那字段" | ✅ 但不同关注点 |
| **W3C PROV** | 实体-活动-代理模型 | -- | 文档/数据集级血缘,非 JS 运行时值级 | ✅ 但层级不对 |
| **Source Maps** | 产物->源码位置映射 | 0 | 位置信息,非数据流 | ✅ 但不同关注点 |
| **商业污点工具**(Contrast/Checkmarx) | 重型插桩,安全导向 | 高 | 漏洞检测,非 dev 探查;非规范 | ❌ |

### 1.3 领域空白(修正表述:空白在"dev 工具形态",非"思想")

**没有任何 dev 工具形态的、低税的、值级血缘方案或规范。** 思想谱系存在,但都没落地成可用的 dev 工具标准:

- **安全污点谱系就是同一项技术**:DOM-XSS 动态污点(Kudzu 等学术研究、DOMinator 类工具、Contrast/Checkmarx IAST)做的就是 "source 字段 -> DOM sink"。**它没有标准化**--这才是最该分析的失败案例:开销宣称不实、精度(碰撞/过染)不敢诚实、只有安全合规拉动没有开发者日常拉动。本提案的差异点(dev UX 拉动、置信度诚实、分层采纳)应对着这个失败案例写,而非假装谱系不存在。
- **调试 provenance 研究**:Whyline("why did this output happen")、theseus(JS omniscient debugger)一脉答的也是"输出的来源"。空白不在"思想",在"可用的、低税的、dev 工具形态的实现"。
- **运行环境边界**:Locker Service / Lightning Web Security 等冻结原型链的安全沙箱,L0 的原型 patch 全灭(fetch/Node.prototype 不可改)-> 写进"做不到"清单;CSP 不影响(patch 是 JS 内行为)。

这个修正后的空白(值级血缘的 dev 工具形态)就是本提案要填的。

---

## 二、第一性原理

### 2.1 原理

> **provenance 是值上的关系,不是位置上的关系。一个值的护照 = 流入它的所有值的护照的并集。**

用户问的是屏幕上的**值**。值换变量名、换属性槽,来源不变。所以护照按**值**存,不按位置存。

### 2.2 引擎三步

一个全局映射 `值 -> 护照`:

1. **基础(API 入口)**:数据进 JS 时,每个字段值的护照 = {它自己}
2. **归纳(运算)**:`result = f(输入)` 产生新值时,护照 = ∪ 输入护照,按 result 值存
3. **查询(DOM 收口)**:写 DOM 值 V 时,查 `护照(V)`,画箭头

**一个映射,并集,查询。** 这是规范的最小内核。

### 2.3 为什么按值是规范的正确地基

- **最小**:一个 map、三种操作,极易 spec 和实现
- **框架无关**:只碰 web 平台原语(fetch/XHR/DOM),不碰 fiber--React/Vue/Svelte 通用
- **分层**:零插桩基线 + 精度层,可渐进采纳
- **诚实**:碰撞在值语义下是"正确"(值相等即不可区分),不谎报精度

按位置追踪(影子变量)的所有税--过缝、Hooks 持久化、fiber 耦合、文本原始值、框架适配器--在按值追踪下不存在。这让规范内核极小且稳定。

---

## 三、最优设计

### 3.1 分层架构(渐进采纳的关键)

| 层 | 内容 | 插桩 | 召回 | 采纳成本 |
|---|------|------|------|----------|
| **L0 零插桩** | I/O 原语拦截建值索引 + DOM 拦截查值 | 无(纯 runtime) | ~60% | 加个脚本 |
| **L1 变换插桩** | + 纯方法/函数调用的并集传播 | Babel 变换 | ~90% | 加构建插件 |
| **L2 位置精化(可选)** | + 影子变量区分碰撞值 | Babel 全量 | 更高精度 | 重型 |

L0 是规范的**基线**--任何 app 加一个 runtime 就能用,无构建改动。L1/L2 是精度增强。这分层是规范能铺开的核心:采纳者按需选层。

### 3.2 L0 核心(规范基线)

```
┌─ Producer(拦截 I/O 原语,建值索引)─────────┐
│  fetch / XHR / WebSocket / SSE / postMessage │
│  / SSR 水合 / storage                        │
│  -> stampOrigin: 值 -> {字段} 进 valueIndex  │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌─ Sink(拦截 DOM 写入,查值)─────────────────┐
│  textContent / innerHTML / setAttribute /    │
│  value / nodeValue / ...                     │
│  -> valueIndex.get(写入值) -> 画边           │
└──────────────────────────────────────────────┘
```

L0 不插桩业务代码,只拦两个 web 平台切面:**数据进**(I/O 原语)和**数据出**(DOM API)。属性读 `data.user.name` 拿到 "Ada"--"Ada" 已在索引(盖戳时存),sink 查到即命中。

### 3.3 L1 变换插桩(精度增强)

L0 对**变换值**失效:`name.toUpperCase()` 产生 "ADA",索引里只有 "Ada",查不到。L1 插桩变换:

- **纯方法**(toUpperCase/toFixed/trim/...):codegen `result$ = recv$ ∪ args$`,按 result 值存。spec 写死纯,sound may-近似。是**纯度分类**,非白名单。
- **不透明函数**:四档恢复(见 3.5)。

L1 只插桩**产生新值的运算**,不插桩属性读--比按位置追踪(插桩每次读)轻一个数量级。

### 3.4 入口 = I/O 原语(第一性)

数据进 JS 的真正入口只有 web 平台原语:

- **网络**:fetch、XHR(覆盖 axios/React Query/SWR/Apollo/GraphQL 等一切 HTTP 库)、WebSocket、EventSource
- **存储**:localStorage、sessionStorage、IndexedDB
- **跨上下文**:postMessage
- **服务端注入**:SSR 水合(`__NEXT_DATA__` / RSC payload)

**库不是入口**(React Query/Apollo/axios 是 fetch/XHR 的消费者)。拦原语,库自动覆盖。

**`JSON.parse` 必须全局重盖(救五条通道)**。localStorage/WebSocket/SSE/postMessage 全是"串进 parse 出":写时 `JSON.stringify` 输出串顶**全响应并集**护照,读时 `JSON.parse` 把全响应并集传给**每个叶子** -> 每片叶子画 N 条边,精度当场死亡。解法:全局 patch `JSON.parse`--输入串有护照则按路径逐叶子重盖(复用 stampOrigin 递归,sourceId 取串来源;无法归因标 `unknown://json`),无护照则原样透传。一条规则救五条通道。**必须拦的是网络原语 + SSR 注入 + JSON.parse**(数据首次进 JS 处)。

### 3.5 不透明函数:四档恢复

对任意不透明函数 `f(输入) -> 输出`,输出护照按置信度四档:

1. **身份匹配**(`输出 === 输入`):`taint` 确定精确
2. **值指纹∩输入**:输出值在索引 -> `value-match`(值唯一时精确)
3. **并集兜底**(输入有标签但前两档没中):`∪ 输入$`,`approx`(可能过染,UI 降权)
4. **CUT**:输入无标签 / 返回外部状态(Math.random/Date.now/eval)

**默认走并集(③),不是 CUT**--对 dev 工具,漏报比低置信过染更糟。CUT 只留给返回外部状态和 eval(闭包访问)。

四档对任意不透明函数成立--lodash/immer/zod/WASM 一视同仁,无需白名单。immer Proxy 难题消解(最终值匹配 ②);dayjs 解(构造器 ③ + 纯方法并集)。

### 3.6 控制边(值追踪最不适合的场景,需侧车)

数据边是纯值查询。控制边(`{isVip && <X/>}` 的存在性)不是值,且**过缝问题对它原样回归**:render 期压栈 pop 后,commit 期 appendChild 才发生,此刻条件栈已空。数据边靠"值熬过缝"躲过,控制边是存在性关系、无值可搭车。

所以控制边**不能靠查值**,需要两件套(见 §4.3b):
- **条件槽位侧车**(L1 必选,非可选):只对条件表达式恢复槽位读(~5% 插桩面),压栈压条件字段的槽位护照,不查 `passport(true)`(布尔低熵会噪声)
- **controlIndex 桥**:L1 求值点把"被条件控制的子树会产出的值"登记进按值索引,commit 期查值时一并查

双支对称(三元/if-else 两支都压栈)、早退区域(`if (cond) return` 之后隐含被 cond 控制)原样保留。**L0 无控制边**(无插桩、无 controlIndex)。

### 3.7 碰撞策略(查询侧诚实,传播侧设防)

两个字段值相同(都 "hello")-> 索引里 "hello" -> {x, y}-> 查到都报。

- **查询侧**:不是 bug,是值语义的正确推论(按值分不出 x 还是 y,报"可能 x 或 y"诚实)
- **传播侧(必须设防,否则假阳性级联)**:`config.maxRetries * 1000` 查 `passport(7)`,低熵值 7 顶着一堆无关字段 -> 7000 顶捏造字段 -> 沿变换链无界放大。三条设防:**低熵值黑名单**(true/false/0/1/""/null 不盖戳,防级联主力)+ **护照集熔断**(|sources|>k 降 collision,封顶)+ **并集标 collision**(输出 = `已有 ∪ (∪输入)`,不 CUT)。**不搞交集 CUT**--`price*qty=14` 撞已在册的 `shippingCost=14`,交集空就 CUT 会静默丢弃真实 price/qty 流(假阴性),违反"碰撞报候选诚实"原则。中熵数字仍可能级联,由熔断封顶。

**精度诚实定位**:字符串高精度,数字降格(碰撞置信度),布尔失效(低熵不追)--布尔恰是控制边主力,所以控制边走侧车(3.6)而非查值。L2 可选补全量按位置精化。

---

## 四、规范协议(Web Data Provenance Protocol, WDPP)

把上面的设计固化成协议,让多工具互操作。

### 4.1 数据模型

```ts
// 一个 DOM 输出的血缘记录
interface ProvenanceRecord {
  node: NodeRef;              // DOM 节点(或属性)
  value?: Primitive;          // 写入的值(控制边存在性无值,optional)
  sources: SourceRef[];       // 哪些 API 字段
  edgeType: 'data' | 'control';
  confidence: 'exact' | 'value-match' | 'approx' | 'collision' | 'none';
  attrName?: string;          // 属性边时
  entityKey?: string | number;// 记录级血缘(数组 index / id)
  lastSeenWrite: number;      // 单调写序号(框架无关,不叫 "commit")
  generation: number;         // 值映射代际(回收用,见 4.7)
}

interface SourceRef {
  sourceId: string;           // canonical = 原始 URL/method(各实现必一致)
  routeTemplate?: string;     // 可选注解(如 "GET /users/:id"),生成规则 informative
  fieldPath: string[];        // ["user", "name"](分段,避免 "." 歧义)
}
```

### 4.2 Producer(拦截点规范)

协议规定 I/O 原语拦截点。**sourceId 的 canonical form 是原始 URL/method(无模板化,各实现必一致)**--路由模板化每个实现各猜各的(slug/日期/复合键),作为协议主键会破坏互操作。`routeTemplate` 降为可选注解字段,字段级归并由消费端自行聚合。

| 原语 | sourceId(canonical) |
|------|----------------------|
| fetch / XHR | `<METHOD> <原始 URL>`(query 丢弃) |
| GraphQL(POST /graphql) | `graphql://<endpoint>#<operationName>`(必须从 body 提取 operationName,否则所有操作共享一个 sourceId,血缘全塌) |
| WebSocket | `ws://<host><path>` |
| EventSource(SSE) | `sse://<url>` |
| postMessage | `postMessage://<origin>` |
| SSR 水合 | `ssr://<entry>` |
| storage(若拦) | `storage://<key>`(标"来源不明") |

**库不是 producer**(它们消费原语)。协议只规范原语级 producer。GraphQL 的 operationName 提取是协议 normative 要求(非可选)--Apollo/urql/Relay 在 fetch 层 body 可解析。

### 4.3 Sink(DOM 归因规范)

DOM 写入归因点(按 WebIDL 对齐主通道,避免规格翻车):

| 出口 | 在哪 | 归因 |
|------|------|------|
| `CharacterData.nodeValue` / `.data` setter、`createTextNode` | CharacterData.prototype | 文本 data 边(**主通道**,React/Vue 走这) |
| `textContent` | Node.prototype(不是 Element) | 文本 data 边(少数路径) |
| `innerHTML` | Element.prototype | html 片段(substring 匹配或标"html 片段",别默默 miss) |
| 已知属性(value/src/...) | `HTMLInputElement.prototype` 等按 **React DOM property 表**逐接口 | 属性 data 边(React 走 property 赋值,不走 setAttribute) |
| 未知属性 | `Element.setAttribute` | 属性 data 边 |
| `style.setProperty` / 各属性 setter | CSSStyleDeclaration.prototype | style data 边 |

**类型归一化**:盖戳存原始值 + `String(v)` 双形态,查询数值化回退(DOM 侧永远是字符串,`7` vs `"7"`)。

**相邻文本拼接查询**:JSX `<span>LV.{level}</span>` 产生两个文本节点,拼接 `"LV."+"7"` 再查命中确定边,不命中再逐个查。

**边清理走 MutationObserver**(监听 childList:removeChild/remove()/normalize 合并不触发 setter),不 patch 删除全家。

**控制边不靠 DOM 拦截(第五轮 P0 修正)。** 旧版写"节点插入(appendChild)->控制边"是错的--appendChild 在 commit 期,条件栈在 render 期早已弹空。数据边靠"值熬过缝"躲过,控制边是存在性关系、无值可搭车,过缝原样回归。控制边由 **controlIndex 桥**实现(见 4.3b)。

### 4.3b 控制边:controlIndex 桥(必读)

L1 条件插桩在**求值点**(条件栈还活着时)把"被条件控制的子树会产出的文本/属性值"登记进按值的 `controlIndex`;commit 期 `onDomWrite` **始终同时查** `valueIndex`(数据边)和 `controlIndex`(控制边),两条边独立画(不能数据边命中就跳过,否则 `{isVip && <em>{user.name}</em>}` 的 isVip 控制边永远丢)。条件护照由**条件槽位侧车**(只对条件表达式恢复槽位读,~5% 插桩面,盖戳双写 SM 供其读取)提供,不查 `passport(true)`(布尔低熵会噪声)。

**精确边界(诚实降级,不提前付逐读税):** controlIndex 只在**内联深层 JSX** 闭环--求值点能拿到子树会产出的值。**跨组件边界失效**:`{showDetail && <DetailPanel data={d}/>}` 的 `&&` 求值点只创建 element,DetailPanel 函数体还没执行,其内部要写的值在求值点不存在、无法登记 -> 面板内文本丢失 showDetail 控制边。而"条件包裹卡片/面板"恰是最高频场景。**协议定位:内联 JSX 控制边 = L1;跨组件控制边 = L2(需位置追踪穿透组件体)。** 不为这个提前把全量属性读改成逐读。

- 字面量碰撞("VIP"/"加载中"多处出现各自由不同条件控制)-> controlIndex 按值合并 -> 标 `approx`
- 同值异处无条件渲染被误画 -> 标 `value-match`(may-分析可接受)
- **L0(零插桩)无控制边**:没有条件栈也没有 controlIndex。L0 仅数据边。
- controlIndex 必须带代际(同 valueIndex 生命周期,否则长 session 膨胀 + 陈旧)

### 4.4 Query API(工具消费接口)

两层接口。**capability 模型(必读,安全命门)**:`window.__wdpp__` 暴露全量字段名/端点/值对应关系给页面任何脚本(第三方 SDK/扩展/广告),是现成数据外泄地图。**必须 opt-in**:仅 dev 或显式开启时挂载(`<meta name="wdpp" content="on">` 或 DevTools 开启);标准化后协议定义 capability 模型,否则浏览器安全评审第一轮毙掉。

**JS API(运行时,opt-in 时挂载):**
```ts
interface WebDataProvenance {
  lookup(node: Node): ProvenanceRecord[];        // 点选反查(DOM->字段)
  queryField(sourceId, fieldPath): Node[];       // 字段->DOM(高亮路径)
  subscribe(callback: (recs: ProvenanceRecord[]) => void): void;  // 批量/节流(microtask 合批,高频 DOM 写防洪水)
  // 节点移除后记录必须回收(与 MutationObserver 清理合流)
}
```

**DevTools Protocol 扩展(未来标准):**
```
Provenance.getProvenanceForNode({nodeId}) -> ProvenanceRecord[]
Provenance.getNodesForField({sourceId, fieldPath}) -> NodeRef[]
Provenance.streamProvenance() -> events
```
shadow DOM:TreeWalker/MutationObserver 默认不进 shadow root,协议注明 pierce 语义或显式不支持 open shadow root 以内;跨 iframe:SOP 下父页查不到子帧节点,每 realm 独立 `__wdpp__`。

### 4.5 置信度(标准化,UI 一致)

| 置信度 | 含义 | UI 建议 |
|--------|------|---------|
| `exact` | 精确(身份匹配 / 唯一值指纹) | 实线 |
| `value-match` | 值匹配(可能碰撞) | 虚线 |
| `approx` | 并集兜底(可能过染) | 点线/降权 |
| `collision` | 护照集熔断(|sources|>k) | 聚合"N 个候选" |
| `none` | 查不到(断流) | 灰/标注盲区 |

### 4.6 分层一致性(Conformance)

机制一致性是 normative;召回率依赖 app 数据形状,仅 informative 注记。

| 级别 | 必须实现(normative) | 参考召回(informative) |
|------|---------------------|----------------------|
| **WDPP-L0** | Producer(原语拦截,含 GraphQL operationName)+ Sink(DOM 拦截,主通道规格)+ 值索引 + 类型归一化 + 低熵黑名单 + 熔断 + 生命周期(代际)+ 大响应分片不阻塞 + Query API(**仅数据边,无控制边**;内联/跨组件控制边均无) | ~60%(字符串) |
| **WDPP-L1** | + 变换插桩(纯方法 + 四档)+ 盖戳双写 SM(供条件侧车)+ 控制边(条件槽位侧车 + controlIndex,**仅内联 JSX;跨组件控制边属 L2**)+ JSON.parse 重盖 + hydration 全扫描 + controlIndex 代际 | ~90%(字符串);内联控制边 |
| **WDPP-L2** | + 全量按位置精化(碰撞值区分)+ 跨组件控制边(位置追踪穿透组件体) | 更高精度;跨组件控制边 |

采纳者声明符合级别,工具按级别渲染。**一致性测试套件与参考实现同生**(见 §五),每个条款配 golden case。

### 4.7 值映射生命周期(必读,否则无界膨胀)

原始值 key 不能用 WeakMap(只接受对象 key)-> 不加管理则永驻 + 陈旧(登出后旧用户护照仍命中新 session 的同值)。

- **双容器**:`WeakMap<object, passport>`(对象,免费 GC)+ `Map<primitive, {passport, generation}>`(原始值,带代际)
- **代际**:路由切换/登出/手动清空时 bump generation,查询过滤过期代,定期 compaction
- **容量上限**:配合 4.5 熔断,单值护照集 |sources| > k 降 `collision`

---

## 五、成为行业规范的路径

### 5.1 三阶段(现实性修正)

```
阶段1(现在):参考实现 + 协议草案 + 一致性套件(同生)
  - 开源 L0 runtime + L1 Babel 插件(参考实现)
  - WDPP 协议文档(本文)
  - 一致性测试套件与参考实现同生:每个协议条款配 golden case(正例记边+反例不记边)
  - 在 1-2 个真实 app 验证召回/开销/内存曲线

阶段2(1-2年):多实现 + 工具采纳
  - 目标:催生第二个独立实现(如 Vue 社区)--单实现的"协议"是 API 文档不是标准
  - DevTools 扩展消费 WDPP Query API(opt-in/capability 模型)
  - React/Vue/Svelte 可选原生支持(暴露 provenance 钩子)
  - AI agent(代码生成/调试)消费 provenance 做数据流问答

阶段3(3-5年):平台原生
  - WICG 孵化 ->(有实现兴趣后)W3C 工作组(Web 标准的现实路径)
  - CDP 增 Provenance 域(浏览器实现)
  - DevTools 模式下按需开启、低开销(类比 sampling profiler)
```

**三处现实性修正(第五轮):**
1. **删 TC39**。JS 语言级 provenance 原语 ≡ 语言级污点,安全社区讨论多年从未推进(Spectre 后浏览器对跨上下文信息流可见性极度敏感);且本提案价值不需语言改动,引擎外全可实现。删 TC39 是加分。
2. **删"浏览器零开销"**。V8 原始值是无盒立即数,值级 provenance 只能靠侧表,内存/GC 代价非零。可信表述是"DevTools 模式按需开启、低开销",不是零开销。
3. **一致性套件提前到阶段1**。L0/L1/L2 的唯一意义是"不同实现产出可对比结果",没套件这三个级别只是营销词。套件与参考实现同生,正合"验收铁律"。

### 5.2 为什么按值追踪利于标准化

- **内核极小**(一个 map),spec 短、实现门槛低、多实现易互操作
- **不绑框架**,浏览器/框架/工具各方都能实现
- **分层**,各方按能力采纳(浏览器做 L0 原生,框架做 L1,工具做 L2)
- **协议而非工具**,像 Source Maps(产物->源码映射)那样,定义数据格式 + 生成/消费接口,多工具共存

### 5.3 治理

- **协议所有权**:社区工作组(仿 OpenTelemetry 的治理模式)
- **参考实现**:开源(MIT/Apache),作为一致性测试基准
- **一致性测试套件**:验证实现符合 WDPP-L0/L1/L2,与参考实现同生

---

## 六、与现有方案对比

| 维度 | Jalangi 系 | React DevTools | CDP | OTel | 安全污点(Contrast 等) | **WDPP(本提案)** |
|------|-----------|----------------|-----|------|---------------------|-------------------|
| 追踪粒度 | 位置 | 组件 | 无 | span | 位置 | **值** |
| 答字段级来源 | 部分(重) | ❌ | ❌ | ❌ | 部分(安全导向) | **✅** |
| 框架无关 | ✅ | ❌(React) | ✅ | ✅ | ✅ | **✅** |
| 开销 | 26-96×~5000× | 0 | 0 | 低 | 高 | **L0≈1.05× / L1~3×** |
| 过缝/Hooks 税 | 有 | -- | -- | -- | 有 | **数据边无;控制边需侧车** |
| 置信度诚实 | ❌ | -- | -- | -- | ❌(不敢承认过染) | **✅(5 档)** |
| 是规范 | ❌ | ❌ | ⚠️缺域 | ✅ | ❌ | **✅(分层)** |
| 渐进采纳 | ❌ | -- | -- | ✅ | ❌ | **✅(L0/L1/L2)** |
| 拉动力 | 学术 | dev | -- | 追踪 | 安全合规 | **dev UX** |

---

## 七、落地与验收

**验收铁律(按档位)**:①身份/②值指纹档"反例不记边";③并集档"反例必须标 `approx` 且 UI 降权"。一致性测试套件与参考实现同生。

```
P-1  L0 基线(零插桩):fetch/XHR + DOM 拦截 + 低熵黑名单 + 相邻文本拼接,一周出可演示绑定图 + 回归真值集
     + 一致性测试套件(与实现同生,每条款配 golden case)
P0   L1 引擎:变换插桩(纯方法 + 四档)+ 类型归一化 + JSON.parse 重盖 + 值映射生命周期(代际)
     + DOM 拦截主通道规格(Node/nodeValue/property 表/MutationObserver)+ hydration 全扫描
     -- go/no-go 加:内存曲线(长 session 映射规模平稳)
P1   控制边:条件栈 + 双支对称 + 早退区域 + 条件槽位侧车(必选)+ controlIndex 桥
P2   生态:WebSocket/SSE/SSR + 多实现(催生第二个独立实现);DevTools UI 置信度;capability/opt-in 模型
P3   L2 精化(可选):碰撞值全量按位置区分
P4   WICG 孵化(有实现兴趣后)-> W3C;CDP Provenance 域
```

**go/no-go**:L0 在真实中型 app 的冷启动 + 交互帧率 + 内存曲线(L0 应近无感,因不插桩业务代码)。

---

## 八、一句话

> 按值追踪把"API 字段 -> DOM 值"的血缘简化成**一个映射、并集、查询**。
> 协议(WDPP)把这个内核固化成分层(I/O 原语 producer + DOM sink + Query API),
> 让浏览器/框架/工具各自实现、互操作--像 Source Maps 之于源码映射那样,
> 成为运行时数据血缘的标准。

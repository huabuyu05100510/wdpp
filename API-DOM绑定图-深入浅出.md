# API -> DOM 绑定图:深入浅出

> 读完这份,你能用一句话向别人解释整套系统。
> 这份只讲"为什么"和"怎么想"。所有机制都从一条原理推导出来,不是拼凑的。

---

## 一、一个问题

用户指着屏幕上任何一个东西问:**"这是哪个接口字段弄出来的?"**

```jsx
// 后端返回: { user: { name: "Ada", level: 7, isVip: true } }
function Profile({ data }) {
  return (
    <div>
      <h1>{data.user.name}</h1>            {/* "Ada" */}
      <span>LV.{data.user.level}</span>    {/* "LV.7" */}
      {data.user.isVip && <em>VIP</em>}    {/* isVip 真才出现 */}
    </div>
  )
}
```

答案只有两种箭头,不多不少:

- **数据边**:字段的**值**流进了内容。`user.name` 的 "Ada" 流进了 `<h1>`。
- **控制边**:字段的**值**决定了"渲不渲染"。`user.isVip` 决定了 `<em>` 出不出现--"VIP" 三个字是写死的,值没流进来,但它的**存在**被 isVip 决定。

整个系统的产出就是一张图:字段节点 + DOM 节点 + 这两种边。

---

## 二、第一性原理:护照属于值,不属于变量

用户问的是屏幕上的**值**。值换个变量名、换个对象属性装,来源没变。所以:

> **provenance(来源)是值上的关系,不是位置上的关系。护照属于值。**

这是整套设计唯一的前提。剩下全是推论。

既然护照属于值,它就该**按值存**--一个全局映射 `值 -> 护照`:

```
"Ada"  的护照 = { user.name }      ← 按值存,谁读到 "Ada" 都拿到这本
7      的护照 = { user.level }
"LV.7" 的护照 = { user.level }     ← 拼接产生的新值,也有护照
"VIP"  的护照 = {}                  ← 字面量,空
```

原始值挂不了属性?没关系--护照不挂在值上,挂在"值 -> 护照"这个映射里,按值查。值是原始值不影响,映射的 key 可以是原始值。

**这一个映射,就是引擎的全部核心。** 没有影子变量,没有按属性槽的影子内存,没有 WeakMap-by-对象。就一个 `Map<值, 护照>`。

---

## 三、从一个原理推导出整个引擎

**原理(一句话):一个值的护照 = 流入它的所有值的护照的并集。**

三步推出引擎:

**① 基础情况(海关盖戳):** API 数据进来时,每个字段值的护照 = {它自己}。存进映射。
```
stampOrigin 后:"Ada" -> {user.name},  7 -> {user.level},  true -> {user.isVip}
```

**② 归纳情况(运算):** `result = f(输入)` 把输入变成新值时,result 的护照 = ∪ 输入的护照。按 result 的值存。
```
"LV." + 7  ->  "LV.7",  护照 = ∅ ∪ {user.level} = {user.level}
存进映射:"LV.7" -> {user.level}
```

**③ 查询(DOM 收口):** 框架往屏幕写值 V 时,查映射 `护照(V)`,画箭头。
```
写 "Ada"   -> 查 {user.name}   -> 画 data 边
写 "LV.7"  -> 查 {user.level}  -> 画 data 边
```

**就这三步。一个映射,并集,查询。没有别的。**

---

## 四、这个原理消解了什么

按"位置"追踪(护照挂变量/属性槽,要插桩每次读写来同步)会引出一堆最难的麻烦。按"值"追踪,它们自动消失:

- **React 的 render->commit 缝:没了。** 缝的问题是"render 时算的标签 commit 时丢了"。但按值存,值在 render 和 commit 是同一个值--commit 时查这个值就行,不用"过缝"。
- **Hooks 跨渲染丢标签:没了。** `useState(x)` 把值存进 React state,重渲染读出来还是那个值--查这个值就行。不用 useRef 持久化标签。
- **框架耦合:没了。** 全是值查询,不碰 fiber。框架只负责"写 DOM 时告诉我写了什么值"。
- **文本节点原始值:没了。** 不用 WeakMap key,按值查,原始值本来就是 key。
- **大部分插桩:没了。** 属性读 `data.user.name` 拿到 "Ada"--"Ada" 已在映射里(盖戳时存的),不用插桩这次读。只有**变换**(toUpperCase、算术、函数调用)产生新值,需要观察并集。

之前几轮评审死磕的过缝、Hooks 持久化、fiber 适配器、文本节点对齐--全是"按位置追踪"才有的税。按值追踪,它们不存在。

**剩下的代价:碰撞(查询侧诚实,传播侧必须设防)。**

- **查询侧**:两个字段值相同(都 "hello"),映射里 "hello" -> {x, y},查到时都报。这不精确但**正确**--按值分不出 x 还是 y,报"可能 x 或 y"诚实。
- **传播侧(必须设防,否则假阳性级联)**:变换插桩时,`config.maxRetries * 1000` 查 `passport(7)`。但 `7` 是低熵值,可能并集了 `user.age`、`cart.count` 等无关字段。算出的 `7000` 顶着一堆捏造的字段,`7000` 再参与下次变换...**假阳性沿变换链无界放大**。一次 `0` 的碰撞(`items.length`、`cart.count`、本地 `i` 全是 0)能污染整条本地计算链。

所以碰撞不是"查询时诚实就行",传播侧必须三条设防:

1. **低熵值黑名单**:`true/false/0/1/""/null` + 可配置词表(状态码、枚举文案)**不盖戳、不查询**。诚实显示"低熵值不追踪"。布尔/数字/枚举本就歧义,硬追是噪声。**这是防级联的主力**--`config.maxRetries = 7` 的 7 是低熵不进映射,`7000` 就不会顶上 `user.age`。
2. **护照集熔断**:查询/传播时 `|护照| > k`(如 5)降置信为 `collision`,UI 聚合显示"N 个候选字段"而非画 N 条边。
3. **并集(不 CUT)**:变换输出护照 = `已有 ∪ (∪ 输入护照)`,标 `collision` 若集合增长。**不搞交集 CUT**--`price * qty = 14` 撞上已在册的 `shippingCost = 14`,交集为空就 CUT 会**静默丢弃真实的 price/qty 流**(假阴性),违反"碰撞报'可能 x 或 y'诚实"的原则。诚实的做法是并集标 collision,让用户看到候选。中熵数字(14/42)仍可能级联,由熔断兜底封顶。

**精度诚实定位**:这个架构对**字符串**(名字、URL、ID)是高精度引擎;对**数字**降格(碰撞置信度);对**布尔**失效(低熵不追)--而布尔恰是控制边主力,见下条。

**控制边不是小例外,是值追踪最不适合的场景。** 控制边(`{isVip && <X/>}` 的存在性)压栈压的是条件值的护照 = `passport(true)` = 应用史上所有值为 true 的布尔字段的并集--三个接口后就是几十条噪声。`loading`/`isEmpty`/`hasError` 全是布尔,偏偏是用户最常问"这由谁控制"的场景。所以控制边**必须**用按位置追踪(只对条件表达式恢复槽位读,见 §八),不能靠查值。数据边保持纯值追踪。

---

## 五、护照从哪来:海关盖戳

API 响应是 `JSON.parse` 的产物--原生黑盒,值"来路不明"。必须在数据进程序的那一刻拦下,亲手遍历,给每个字段值盖"出生戳",存进映射:

```
fetch("/users/42")
  └─ res.json() 被拦下 -> 递归遍历
     "Ada"  -> { "GET /users/:id.user.name" }
     7      -> { "GET /users/:id.user.level" }
     true   -> { "GET /users/:id.user.isVip" }
```

这是整条链的源头。不做这步,后面全空。

盖戳的细节(每个都是踩坑逼出来的):

- **后序并集**:对象属性的值,护照要并上子树叶子字段。`user.name` 的值 "Ada" 护照 = {user.name};若整个 user 对象被 stringify 上屏,各属性值各自在映射里,查到各自字段。
- **数组 length 也要盖戳**:列表页标配 `{items.length === 0 && <Empty/>}`,length 不打标则空态控制边全丢。length 的值(数字)也要进映射。
- **循环引用保护**:手动接入的数据(WebSocket、已水合 store)可能有环--加 visited 集合,否则栈溢出。
- **字段路径别用字符串拼**:`{"user.name": "Ada"}` 和 `{user:{name:"Bob"}}` 拼出来都是 `"user.name"` -> 共享 key -> 互相污染。用分段数组做 key。
- **低熵值不盖戳**:`true/false/0/1/""/null` + 可配置词表(状态码、枚举文案)跳过。盖了也是碰撞噪声,还污染传播侧(§四)。
- **类型归一化桥**:盖戳时数字/布尔同时存原始值和 `String(v)` 两个 key--因为 DOM 侧写入永远是字符串(`nodeValue`/`textContent`/`setAttribute` 全是 string),`{level}` 上屏变 `"7"`,只存 number 7 查不到。双形态存,查询时也数值化回退。
- **双写 SM(为条件槽位侧车)**:§八 的条件槽位侧车要读**字段级**护照(`SM(data.user).fields.get('isVip')` = `{user.isVip}`,不是查值 `passport(true)`)。所以盖戳除了写值索引,还要**同时写一份 SM**(`WeakMap<object, {fields: Map<key, passport>}`)--但 SM 只服务于条件侧车,数据边仍走值索引。这是按值架构为控制边付的"局部位置税",只覆盖条件表达式触及的对象,不全量。
- **大响应不阻塞主线程**:stampOrigin 递归遍历大响应(千条列表、深嵌套)是同步的,会卡 main thread。解法:分片 + 让出(`scheduler.yield()` 或 setTimeout 切片),按路径分批盖戳;或先盖浅层、深层 lazy(读到时再盖)。

盖戳要拦的入口--**第一性:只拦 I/O 原语,库自动覆盖**。数据进 JS 环境的入口只有这些原语,React Query / Apollo / GraphQL / axios / SWR 都不是入口,它们是建在 fetch/XHR 之上的库,拦了原语就全覆盖:

- **网络**:`fetch`、`XMLHttpRequest`(这两个覆盖 axios/React Query/SWR/Apollo/GraphQL 等一切 HTTP 库)、`WebSocket`、`EventSource`(SSE)
- **存储**:`localStorage`、`sessionStorage`、`IndexedDB`
- **跨上下文**:`postMessage`(iframe/worker)
- **服务端注入**:SSR 水合数据(`__NEXT_DATA__` / RSC payload,数据嵌在 HTML 里,客户端没走 fetch)

**GraphQL 的 sourceId 黑洞(必须单独处理)。** GraphQL 所有操作都打到同一 `POST /graphql`--sourceId 若只取 URL,所有 query/mutation 的字段共享一个 sourceId,血缘全塌成"来自 graphql"。必须从请求体提取 `operationName`(及可选 query 文本的首个操作名),sourceId = `graphql://<endpoint>#<operationName>`。Apollo/ur Relay 等库的拦截在 fetch 层就能拿到 body,解析 operationName。

**`JSON.parse` 必须全局重盖(救五条通道)。** localStorage/WebSocket/SSE/postMessage 全是"串进 parse 出":写时 `JSON.stringify(data)` 输出串顶**全响应并集**护照,读时 `JSON.parse(串)` 把全响应并集传给**每个叶子** -> 每片叶子画 N 条边,精度当场死亡。解法:全局 patch `JSON.parse`--若输入串有护照,按路径逐叶子重盖(复用 stampOrigin 递归,sourceId 取串护照来源;无法归因标 `unknown://json`);输入串无护照则原样透传。一条规则救五条通道。

**值映射要有生命周期(不能无限累加)。** 原始值 key 不能用 WeakMap(只接受对象 key)-> 每个 "Ada"、`7` 永驻内存;长 dev session(热更新几十次、切账号、翻页)映射无界膨胀,且**护照会陈旧**:用户登出后旧用户的 "Ada"->{user.name} 仍在册,新 session 里任何地方渲染 "Ada"(哪怕写死的)都画出死人的边。所以:对象用 `WeakMap<object, passport>`(免费 GC),原始值用 `Map<primitive, passport>` 带**代际(generation)**--路由切换/登出/手动清空时 bump generation,查询过滤过期代,定期 compaction。controlIndex 同样要带代际(否则同病)。配合护照集容量上限(§四熔断)。

---

## 六、护照怎么过运算

运算不创造来源,只搬运。**输出值的护照 = 输入值护照的并集。** 按输出值存进映射。

```
const label = "LV." + data.user.level;
// "LV.7" 的护照 = ∅ ∪ {user.level} = {user.level}
// 映射里存:"LV.7" -> {user.level}
```

**关键:属性读不用插桩。** `data.user.name` 拿到 "Ada"--"Ada" 已在映射里(盖戳时存的),读出来直接用,到 sink 查就行。只有**产生新值的运算**(拼接、算术、函数调用)需要插桩:观察输入,并集,按输出值存。

几个规则:

- **纯方法**(`toUpperCase`/`toFixed`/`trim`/`slice`):输出 = f(receiver, 参数),无副作用。`result$ = recv$ ∪ args$`。spec 写死纯,所以这是 sound 的 may-近似,不是白名单--是**纯度分类**:纯则并集,非纯走下一章。
- **`&&` / `||`**:`{isVip && name}` 渲染值来自 name(数据边),选不选由 isVip 决定(控制边)。数据护照 = name$,控制护照 ∪= isVip$。两条通道都记。
- **mutation / delete 不用特殊处理(参与过就永久在册)。** 映射按值存,一个值的护照在它"诞生"时就定下(API 值盖戳时、变换产生新值时),之后**永久不变**。`data.user.name = "Bob"` 只是让这个槽位指向 "Bob" 这个值--"Bob" 的护照是它自己的(字面量则空),sink 查 "Bob" 即可。`delete a.b` 让槽位变 `undefined`(护照空),sink 查 `undefined` 没边。**旧值 "Ada" 仍在映射里--它参与过,就包括在内--但没人再写它,所以查不到。** 这正是你说的"直接参与过就应该包括在内":值的护照一经确立就不清,delete 不清任何槽(根本没有"槽"可清,只有按值的映射)。除非别处又写出 "Ada",那是碰撞(见 §四),不是 delete 的问题。

**精度命门:field-sensitive 自动满足。** 按值存,不同字段值不同(通常),护照自然分开。`obj.greeting = "hi"` 和 `obj.level = 7`(API)--"hi" 和 "7" 是不同值,不同护照,不互相污染。只有值相同才碰撞(见 §四)。

---

## 七、过函数边界:不用白名单

三方库(lodash/immer/zod)是黑盒。前人"白名单插桩"是工程 hack:要枚举库、配构建、版本一变就失效。第一性原理:库本质就是个函数,输入进、输出出。我们在边界已知输入的护照,输出护照有四档恢复:

1. **身份匹配**(确定):输出 === 某输入(引用相等)-> 精确继承。`_.identity(x)` 命中。
2. **值指纹匹配**(确定):输出值在映射里查到 -> 与输入护照并集求交。`_.get(user,'name')` 返回 "Ada",查映射得 {user.name}。
3. **并集兜底**(approx,低置信):输入有护照但前两档没中 -> 输出大概率与输入有关,`result$ = ∪ 输入$`。解决变换值查不到(`dayjs(x).format()`、WASM 计算)。可能过染,标 approx,UI 降权。
4. **CUT**:输入无护照,或返回外部状态(`Math.random`/`Date.now`/`eval`)。

**默认走并集(③),不是 CUT。** 对 dev 工具,漏报比低置信过染更糟--用户看到"可能 user.level(approx)"会去核实,看到"没边"会误以为真没 API 数据。CUT 只留给返回外部状态和 eval(数据经闭包,不在参数)。

这四档对任意不透明函数成立--lodash/immer/zod/原生/WASM 一视同仁,无需白名单。

immer 的 Proxy 难题消解:`produce` 返回的最终对象,属性值就是原 API 值,值指纹匹配(②)直接恢复。dayjs 也解:`dayjs(x)` 返回对象走 ③(`dayjsObj$ = x$`),`.format()` 纯方法并集,两步确定。

高频原生(`.map`/`.filter`)走逐元素 patch 保精度,其余走四档。两者互补。

---

## 八、看不见的护照:控制边

`<em>VIP</em>` 的 "VIP" 护照空,但它**出现与否**被 isVip 决定。光查值查不到这种关系。

需要第二本护照:不是"这值是谁造的",而是"**这段代码能不能执行,由谁决定**"。机制是**条件栈**:

```
进入 if (isVip) { ... }:
  把 isVip 的条件护照压栈        ->  栈 = [isVip]
  期间渲染的节点,画控制边
  离开 if,弹栈                  ->  栈 = []
```

两本护照永不串味:数据护照只管值从哪来;条件护照只进条件栈、只产控制边,绝不回头污染数据护照。

**控制边必须对称。** 按定义"值决定渲不渲染",否支和早退之后的代码也由条件控制:

```jsx
{loading ? <Spinner/> : <Content/>}   // Content 也由 loading 决定 ✅
if (err) return <Error/>;
return <Main/>;                        // Main 恰因 err 为假才渲染 ✅
```

所以三元/if-else 要**双支都压栈**;`if (cond) return` 之后的语句隐含被 cond 控制。"加载/空/内容三态切换"恰是用户最常指着问"这由谁控制"的场景。

**条件护照不能查值--必须用按位置追踪(条件槽位侧车)。** 这是 §四说的"控制边是值追踪最不适合的场景"的落地。压栈若压 `passport(isVip 的值)` = `passport(true)` = 应用史上所有 true 布尔的并集,三个接口后就是噪声。

解法是**条件槽位侧车**:只对**条件表达式**(`if/三元/&&/||/while` 的条件子表达式)恢复旧方案的槽位读(SM + WeakMap),压栈压的是**条件字段的槽位护照**(`SM(data.user).fields.get('isVip')` = `{user.isVip}`),不是查值。插桩面从"全部属性读"缩到"条件表达式内的属性读"--不到属性读总量的 5%,量太小,快慢道都不需要,直接全慢道。控制边精度回到字段级,数据边保持纯值追踪。

**控制边还躲不掉过缝(第五轮)。** render 期压栈 pop 后,commit 期 `appendChild` 才发生--此刻条件栈已空,拦截器拿不到 isVip。数据边靠"值本身熬过缝"躲过(render 的 "Ada" 和 commit 写入的是同一字符串);控制边是**存在性关系**,没有任何值可搭 condition 的便车。所以控制边需要一座 **controlIndex 桥**:L1 在求值点(条件栈还活着时)把"被条件控制的子树会产出的文本/属性值"登记进一本按值的控制索引;commit 期 `onDomWrite` **始终同时查** `valueIndex`(数据边)和 `controlIndex`(控制边),两条边独立画。

```
// 编译 {isVip && <em>VIP</em>}
// 求值点(条件栈活):controlIndex.add("VIP", isVipSlotPassport)
// commit 写 "VIP":查 valueIndex -> 数据边空;查 controlIndex -> 控制边 {isVip}
// 注意:不能"数据边命中就 return",否则 {isVip && <em>{user.name}</em>} 的 isVip 控制边永远丢
```

**controlIndex 的精确边界(诚实降级,不提前付逐读税):** 它只在**内联深层 JSX** 闭环--求值点能拿到子树会产出的值(如 "VIP"、`{name}` 的 name)。**跨组件边界失效**:`{showDetail && <DetailPanel data={d}/>}` 的 `&&` 求值点只创建了 element,`DetailPanel` 函数体还没执行,它内部要写的值在求值点不存在、无法登记 -> 面板内所有文本丢失 showDetail 控制边。而"条件包裹卡片/面板"恰是控制边最高频场景。**诚实定位:内联 JSX 控制边 = L1;跨组件控制边 = L2(需位置追踪穿透组件体)。** 不为这个提前把全量属性读改成逐读(那是 L2 的税,L1 不付)。

字面量碰撞("VIP"/"加载中"多处出现各自由不同条件控制)会让 controlIndex 按值合并噪声,这类边标 `approx`。**L0(零插桩)没有条件栈也没有 controlIndex,控制边能力为零--L0 仅数据边。** controlIndex 也要带代际(同 valueIndex,否则长 session 膨胀 + 陈旧)。

---

## 九、画箭头的那一刻

所有护照流到写 DOM 的唯一出口收口。按值追踪,这步极简:**拦截 DOM 写入,查值**。

```ts
function onDomWrite(node, value, attrName?) {
  // 类型归一化:DOM 侧永远是字符串,盖戳侧有类型(7 vs "7")
  const keys = normalizeKeys(value);          // [value, String(value)] 双形态查
  let stamp = keys.map(k => valueIndex.get(k)).find(s => s && !空(s));
  // 相邻文本拼接查询:仅文本节点,与 previousSibling(及 nextSibling)拼成完整串再查
  //   <span>LV.{level}</span> -> 两文本节点 "LV."+"7",拼 "LV.7" 命中 {user.level}
  //   挂载规则:只在单值 miss 时触发;只拼同一父元素下相邻文本兄弟;不跨元素边界
  if (!stamp && isTextNode(node)) stamp = tryConcatAdjacentSiblings(node);

  // 数据边(可能为空)
  if (stamp) {
    if (|stamp| > 熔断阈值) 画 collision 聚合边(node, stamp, attrName);
    else for (field of stamp) 画 data 边(node, field, attrName);
  }
  // 控制边:始终独立查 controlIndex,不因数据边命中就跳过
  //   {isVip && <em>{user.name}</em>}:name 数据边 + isVip 控制边,两条都要画
  const ctrl = controlIndex.get(value) ?? controlIndex.get(keys[1]);
  if (ctrl) for (field of ctrl) 画 control 边(node, field, attrName);
}
```

**DOM 拦截的主通道(规格容易翻车,按 WebIDL 对齐):**

| 出口 | 在哪 patch | 说明 |
|------|-----------|------|
| 文本 | `CharacterData.prototype.nodeValue` / `.data` setter、`document.createTextNode` | **这才是 React/Vue 写文本的主通道**,不是 textContent |
| textContent | `Node.prototype`(不是 Element) | 少数路径,patch Node 不 patch Element(否则遮蔽自有属性) |
| 属性(已知) | `HTMLInputElement.prototype.value`、`HTMLImageElement.prototype.src`... 按 **React DOM property 表**逐接口 patch | React 对已知属性走 property 赋值,不走 setAttribute |
| 属性(未知) | `Element.prototype.setAttribute` | 未知属性才走这条 |
| style | `CSSStyleDeclaration.prototype.setProperty` + 各属性 setter | |
| innerHTML | `Element.prototype.innerHTML` | 整串 HTML 查必 miss,substring 匹配或标"html 片段" |

**边清理走 MutationObserver,不 patch 删除全家。** `removeChild`/`remove()`/`normalize()`(合并文本不触发 setter)靠 `MutationObserver` 监听 childList 兜底清理,比 patch 一堆删除 API 干净。

**hydration 首屏要全扫描。** SSR 水合时,已有 DOM 文本节点匹配成功**不触发任何 DOM 写**--`nodeValue` setter 一次不 fire -> 首屏零边。解法:hydration 完成后用 `TreeWalker` 走一遍全 DOM,查映射补边。旧架构做这事要虚拟 commit + fiber 遍历;本架构就是几十行 TreeWalker--这是按值追踪的红利。

没有 fiber 遍历,没有 stampMap,没有 onCommitFiberRoot,没有 DevTools hook 注入。框架只要写 DOM,就被拦下--React/Vue/Svelte 一视同仁。

**双向索引。** 正向(字段->DOM)画高亮路径,反向(DOM->字段)点选 O(1) 反查--这是产品的核心交互。

---

## 十、剩下的坑

按值追踪消解了一大片坑:过缝、Hooks 持久化、文本节点原始值、全局状态串味、冻结对象(盖戳只**读**对象枚举属性值,不写对象,冻结不挡)。但 §四/§五/§八 已点了三个真问题,这里收口:

**一、碰撞的双面性(§四)。** 查询侧诚实(值相等即不可区分),但传播侧会假阳性级联。设防:低熵值黑名单(防级联主力)+ 护照集熔断(封顶)+ 并集标 collision(不 CUT,避免假阴性)。**精度定位**:字符串高精度,数字降格,布尔失效。

**二、控制边需要侧车(§八)。** 控制边是值追踪最不适合的场景--布尔低熵、且过缝问题对存在性关系原样回归。条件槽位侧车(只对条件表达式恢复槽位读,~5% 插桩面)+ controlIndex 桥(求值点登记、commit 期查)让**内联 JSX** 控制边在 L1 闭环(带近似);**跨组件控制边**(`{show && <Panel/>}`)降级到 L2(需位置追踪穿透组件体)。L0 无控制边。

**三、值映射生命周期(§五)。** 原始值不能 WeakMap,无限累加会膨胀 + 陈旧(passport 过期仍命中)。双容器(WeakMap 对象 + Map 原始值带代际)+ 容量上限。

**四、变换插桩开销。** 属性读不用插桩,只插桩变换(纯方法 codegen 并集 + 不透明函数四档)。比"插桩每次读"轻一个量级。

**五、冻结原型链沙箱(Locker/LWS)。** 这类安全沙箱冻结 `fetch`/`Node.prototype`,L0 的原型 patch 全灭。写进"做不到"清单;CSP 不影响(patch 是 JS 内行为)。

**六、CSS 生成内容 / canvas 文本。** 值经 CSSOM/Canvas API,DOM 拦截看不到。做不到,一行即可。

---

## 十一、这张图怎么用

图本身是产品。用户的核心交互是**点 DOM 节点 -> 反查字段**。

- **双向索引**:正向(字段->DOM)画高亮路径,反向(DOM->字段)点选 O(1) 反查。
- **时间维度**:tab 切换后同一位置先后被不同字段驱动。边上带"最后见到的 commit",UI 默认只显示当前 commit 的边,可切历史视图--既不脏图,也不丢"可由多字段驱动"的真实信息。
- **记录级血缘**:`/users/1` 和 `/users/2` 归一为同字段(位图不爆炸),边上可选携带记录标识(数组 index / id 值),UI 高亮同记录的其他边。用户指着列表某行问,能答"来自第 2 条记录的 user.name"。

---

## 十二、什么做不到

按值追踪 + 四档恢复,大部分"黑盒"其实能出边(部分带 approx)。真做不到的很少:

- **eval / new Function**:数据经闭包访问,不在参数里;且可访问任意外部状态。CUT。
- **Math.random / Date.now**:返回外部熵,与输入无关。CUT。
- **Apollo Client**:normalized cache 把对象拆散重组,库内未插桩。UI 检测到时提示。
- **WASM**:变换值走并集兜底(approx),基本能用。
- **dayjs/moment `.format()`**:能做(构造器并集 + 纯方法)。
- **组件返回原始值**:能做(值到 DOM 查询,不依赖 fiber 对齐)。
- **zustand / Redux(非 immer 路径)**:对象引用传递,值在映射里,基本可用。

Dev 模式的优势:UI 诚实显示边的置信度(`taint` 确定 / `value-match` 值匹配 / `approx` 并集兜底 / 断流),用户不会把盲区当 bug,也不会把低置信当确定。

---

## 十三、怎么落地

**验收铁律(按档位重述)**:①身份/②值指纹档"反例不记边";③并集档"反例必须标 `approx` 且 UI 降权",否则 CI 正反例没法写。

```
P-1  L0 值指纹层(先做,一周出可演示绑定图 + 回归真值集)
     + 低熵值黑名单 + 相邻文本拼接查询
P0   L1 引擎内核:盖戳建值索引 + 类型归一化桥 + JSON.parse 重盖
     + 变换插桩并集(纯方法 + 四档)+ DOM 拦截收口(Node/nodeValue/property 表/MutationObserver)
     + 值映射生命周期(代际)
     -- go/no-go 加一条:内存曲线(长 session 映射规模必须平稳)
P1   控制边:条件栈 + 双支对称 + 早退区域 + 条件槽位侧车(必选,不是可选)+ controlIndex 桥
P2   生态:WebSocket/SSE/SSR 拦截 + hydration 全 DOM 扫描;置信度 UI(taint/value-match/approx/collision/断流)
P3   L2 精化(可选):碰撞频繁场景补全量按位置追踪
```

按值追踪下没有 React 适配器的过缝/Hooks 大坑,P0/P1 大幅简化。先做 L0 拿 60% 演示价值 + 回归真值集。go/no-go 看真实中型 app 的冷启动 + 交互帧率 + **内存曲线**。

---

## 一句话总结

> 程序里每个值,都按它的值存在一个映射里,映射记着"这值由哪些 API 字段算出来的"。
> API 进来时盖戳,运算时并集,写 DOM 时查值画箭头。
> 一个映射,并集,查询--数据边没有过缝、没有 fiber、没有框架耦合;控制边是例外,需侧车 + controlIndex,且跨组件边界降级到 L2。

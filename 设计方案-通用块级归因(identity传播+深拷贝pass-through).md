# WDPP 实现方案:通用块级归因(identity 传播 + 深拷贝 pass-through)

> 现行实现(2026-08-06)。worker=通用块级归因(不 by case),identity 沿数据流传播(深拷贝 pass-through 解决根 identity 断),字段级精确优先 + 块级降级。参考 `DESIGN.md`(WDPP canonical),但以 identity 传播解决第一性原理问题。

---

## 0. 目标与非目标

**目标**:任意 React dev 项目,屏幕上每个 DOM 节点能反查到来源 API + 字段路径,给"数据血缘"。

**非目标**:
- 不追求 100% 字段级精确(深拷贝/库内部变换/低熵值有信息论限制)。
- 宁可不精确(块级 + 置信度),不假精确。
- 不针对 antd/MUI/任何特定组件库(通用机制,任意 React 组件)。

---

## 1. 第一性原理(基于 DESIGN.md)

1. **两端可观测,中间不可观测**:网络层(数据进) + DOM 写入点(数据出) 为物理瓶颈。中间 state/props/map/聚合信息论不可达。
2. **追踪 identity,不追踪 value**:identity = `{requestId, jsonPath}` 的集合,沿数据流并集传播(taint 语义)。value 不可区分并发。
3. **拦截 sink,不观察 DOM**:DOM 写入那一刻读 identity,不事后值匹配(DESIGN.md §1)。
4. **identity 传播 > 值反查**:深拷贝(umi/lodash/structuredClone) 断对象身份,byVal 值反查碰撞过近似。解法=身份传播(§7.7 pass-through)。
5. **按组件块级归因,字段级优先**:组件块整体 union(§7.5),字段级精确优先 + 块级降级(§9 置信度)。

---

## 2. 架构(8 层,通用不 by case)

| 层 | 文件 | 职责 |
|---|---|---|
| **网络拦截** | `src/stamp-origin.js` | fetch/XHR/WS/SSE/postMessage/JSON.parse 全拦,响应对象递归盖戳 |
| **identity 盖戳** | `src/stamp-origin.js` | 值索引 + objectIndex(子树并集) + `__wdpp_fields` + byVal + SM 槽位 |
| **babel transform** | `babel/plugin.js` | 14 visitor:app 代码 L2 插桩(`__readProp`/`__recover`/`__passthrough`/`__fieldGet`/`__aggr`/`__control*`/`__readSlot`) |
| **DOM sink** | `src/dom-sink.js` | patchAccessor 拦截 nodeValue/textContent/data/setAttribute/property/innerHTML/createTextNode |
| **value-index** | `src/value-index.js` | `Map<值, passport>` + `WeakMap<对象, 子树并集>` + 低熵黑名单 + 熔断 + 代际 |
| **component-bind** | `src/component-bind.js` | 通用块级归因(`bindComponentData`) + 字段级 commit 定案(`bindFiberCommit`) |
| **graph** | `src/graph.js` | 边存 + 双向索引 + lookup 祖先回退优先字段级 + `notifyUpdate` |
| **overlay** | `src/overlay.js` | paint allEdges(`[title]` hover) + 常驻屏幕叠加 |

不变量:core 一份(`src/`)。换框架只换 component-bind 的 fiber hack;换构建工具只换 babel/plugin 接线。

---

## 3. identity 盖戳(`src/stamp-origin.js`)

`stampOrigin(obj, sourceId)` 递归给响应对象盖身份:

| 信号 | 含义 | 含低熵 |
|---|---|---|
| **值索引** `Map<值, passport>` | 原始值的字段护照 | 否(低熵跳过) |
| **objectIndex** `WeakMap<obj, 子树并集>` | 对象子树身份(过近似) | 否(低熵字段位不进) |
| **`__wdpp_fields`** `{field: passport}` | 字段位并集(非可枚举,不污染迭代) | 是 |
| **byVal** `globalThis[值] = fieldMap` | 值反查深拷贝后 record(降级) | 是(fieldMap) |
| **SM 槽位** `WeakMap<obj, {fields: Map<key, passport>}>` | 字段 passport(含低熵) | 是 |

**深拷贝场景**:objectIndex/`__wdpp_fields`/SM(WeakMap 按对象身份)全部断。byVal 是值反查兜底(碰撞过近似,违反 §1)。

---

## 4. 深拷贝 pass-through(DESIGN.md §7.7 + identity 传播)

**核心**:深拷贝是纯函数(输出结构=输入),babel 识别后包 `__passthrough`,递归复制 src identity 到 dst,让深拷贝后新对象仍带**字段级** identity。

### 4.1 babel 识别(`babel/plugin.js`)

```js
const DEEP_CLONE_FNS = new Set(['cloneDeep','structuredClone','deepClone','deepcopy','deepCopy']);

function isDeepCloneCall(path) {
  const callee = path.node.callee;
  // cloneDeep(x) / structuredClone(x) / _.cloneDeep(x) / lodash.cloneDeep(x)
  if (t.isIdentifier(callee) && DEEP_CLONE_FNS.has(callee.name)) return true;
  if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property)
      && DEEP_CLONE_FNS.has(callee.property.name)) return true;
  // JSON.parse(JSON.stringify(x)) 模式
  if (t.isMemberExpression(callee) && !callee.computed
      && t.isIdentifier(callee.object,{name:'JSON'}) && t.isIdentifier(callee.property,{name:'parse'})) {
    const arg0 = path.node.arguments[0];
    if (t.isCallExpression(arg0)) {
      const inner = arg0.callee;
      if (t.isMemberExpression(inner) && t.isIdentifier(inner.object,{name:'JSON'})
          && t.isIdentifier(inner.property,{name:'stringify'})) return true;
    }
  }
  return false;
}
// CallExpression: 深拷贝走 __passthrough,其余 __recover
const helper = isDeepCloneCall(path) ? '__passthrough' : '__recover';
```

`isRecoverArg` 改用 `HELPERS.has(callee.name)`(防 `__passthrough`/`__recover`/`__aggr` 等第一参数重入)。

### 4.2 `__passthrough` + `copyIdentityDeep`(`src/babel-runtime.js`)

```js
function copyIdentityDeep(src, dst, visited) {
  if (!src || !dst || typeof src !== 'object' || typeof dst !== 'object') return;
  if (src === dst) return;               // 浅拷贝引用共享,无需复制
  if (!visited) visited = new WeakSet();
  if (visited.has(src)) return;            // 循环引用保护
  visited.add(src);
  const sp = getStamp(src);               // objectIndex 子树并集
  if (sp && sp.passport) stampValuePassport(dst, sp.passport);
  if (src.__wdpp_fields) {                // 字段位并集(含低熵 status)
    try { Object.defineProperty(dst, '__wdpp_fields',
      { value: src.__wdpp_fields, enumerable: false, configurable: true, writable: true }); } catch {}
  }
  for (const k in src) {
    try {
      const slot = smGet(src, k);          // SM 字段槽位(含低熵)
      if (slot) smSet(dst, k, slot);
    } catch {}
    const sv = src[k], dv = dst[k];
    if (sv && dv && typeof sv === 'object' && typeof dv === 'object') {
      copyIdentityDeep(sv, dv, visited);   // 递归子字段
    }
  }
}
export function __passthrough(result, inputs) {
  if (result && typeof result === 'object' && inputs) {
    for (const arg of inputs) {
      if (arg && typeof arg === 'object') copyIdentityDeep(arg, result);
    }
  }
  return result;
}
```

### 4.3 与 `__recover` 的关键区别

| | `__recover(result, inputs)` | `__passthrough(result, inputs)` |
|---|---|---|
| 语义 | 通用函数(并集,根并集) | 深拷贝(递归复制字段 identity) |
| 字段级 | ❌ 只给 result 根护照 | ✅ 递归 SM + `__wdpp_fields` + objectIndex |
| 适用 | 任意函数调用 | 深拷贝结构相同(结构对应) |
| 碰撞 | 输入并集(声明式) | per-object(无碰撞) |

`__passthrough` 给出**字段级精确** SM 槽位,后续 `__readProp(result, 'field')` 命中精确字段护照;不像 `__recover` 降级到根并集(过近似)。

### 4.4 碰撞解决(per-object identity)

| | byVal 值反查 | pass-through identity 传播 |
|---|---|---|
| 机制 | `byVal[值] = fieldMap` | 复制 src identity 到 dst |
| 同值不同源 | **碰撞**(`a.name="John"` 和 `b.name="John"` 撞 byVal["John"]) | 不碰撞(per-object) |
| 低熵 | 跳过 | 复制 `__wdpp_fields`/SM(含低熵字段位) |
| 精度 | 块级过近似 | 字段级精确 |
| 第一性原理 | 违反 §1(追踪 value) | 符合 §5(identity 传播) |

多输入并集(`merge(a,b)`):result 带 a ∪ b identity(过近似 claim 所有输入),但这是 identity 并集(taint 语义,§2),非值碰撞。诚实标 block。

### 4.5 限制

- **白名单覆盖**:`cloneDeep`/`structuredClone`/`JSON.parse(JSON.stringify)` + 可配白名单。自定义 `deepCopy` 未识别仍断(降级 byVal 兜底)。
- **递归开销**:同阶深拷贝开销(大对象可接受)。
- **结构对应假设**:深拷贝保证结构相同;通用变换(`merge`/`format`)不保证,只根并集(`__recover` 覆盖)。
- **循环引用**:`visited` WeakSet 保护。

---

## 5. babel transform(`babel/plugin.js`)

14 visitor,L2 模式全原语插桩:

| 节点 | 产物 | 用途 |
|---|---|---|
| BinaryExpression `(+, -, *, /)` | `__recover(a op b, [a,b])` | 二元运算结果带输入并集 |
| TemplateLiteral | `__recover(\`...${a}\`, [a])` | 模板字符串 |
| CallExpression | `__passthrough(fn(a), [a])` (深拷贝) / `__recover(fn(a), [a])` (其余) | 库作整体算子 + 深拷贝特殊 |
| MemberExpression `obj[k]` | `__fieldGet(obj, k)` | 动态 key -> 控制边(lookup[code]/valueEnum) |
| MemberExpression `obj.key` (L2) | `__readProp(obj, 'key')` | 字段 passport + 渲染 fiber 记账 |
| `__recover`/`__passthrough`/`__aggr` 等 | 裸标识符(不重入) | 全原语 |
| `if (cond)` / `Loop` / `Switch` | `__controlEnter`+`__controlExit` | 控制上下文栈 |

`__readProp` 渲染 fibre 记账(`fiberReads` WeakMap,§7.6),commit 期 `bindFiberCommit` 按 fiber 定案字段边。

---

## 6. DOM sink(`src/dom-sink.js`)

`patchAccessor` 拦截 DOM 写入:

```js
patchAccessor(CharacterData.prototype, 'nodeValue');  // 主文本通道
patchAccessor(CharacterData.prototype, 'data');
patchAccessor(Node.prototype, 'textContent');
patchAccessor(Node.prototype, 'innerHTML', 'html');
patchAccessor(Element.prototype, 'className', 'class');
patchAccessor(HTMLInputElement.prototype, 'value');
patchAccessor(HTMLInputElement.prototype, 'checked');
patchAccessor(HTMLImageElement.prototype, 'src');
// ... etc
```

`onDomWrite(node, value, attrName)`:
1. `getStamp(value)` 值通道(字段级 exact/value-match)
2. `controlGet(value)` + 控制栈(approx) 控制边
3. `tryConcatAdjacent(node)` 相邻文本拼接救"LV."+"7"="LV.7" 命中
4. `recordEdge` 存图

---

## 7. 通用块级归因(`src/component-bind.js`)

**不 by prop 名**(删 `DATA_PROP_NAMES` 枚举),扫**所有** props,按三档信号识别数据源:

```js
function objectIdentity(obj) {
  // 1. __wdpp_fields(含低熵)  2. objectIndex  3. leafUnion byVal(降级)
  if (obj.__wdpp_fields) { let u = 0n; for (const fk in obj.__wdpp_fields) u |= obj.__wdpp_fields[fk]; if (u) return u; }
  const s = getStamp(obj); if (s?.passport) return s.passport;
  return 0n;
}
function dataSourcesBits(props) {
  let union = 0n;
  for (const k in props) {
    const v = props[k];
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) for (const item of v) { const ib = objectIdentity(item) || leafUnion(item); if (ib) union |= ib; }
    else { const bits = objectIdentity(v) || leafUnion(v); if (bits) union |= bits; }
  }
  return union;
}
```

`bindComponentData(root)`:遍历 fiber 树,每个有数据源的 fiber -> `findHost(fiber)` 外层 host 元素 -> `recordEdge(union, host, 'data', 'block')` 块级归因。

`bindFiberCommit(root)`:遍历 fiber 树,读 `getFiberReads(fiber)`(`__readProp` 在 render 期记的 `[obj,key]`),查 `smGet(obj,key)` 字段护照(含低熵,深拷贝断 SM 则降级 `objectIdentity(obj)` 整个对象并集/leafUnion byVal)-> 字段级边。

---

## 8. graph lookup 祖先回退优先字段级(`src/graph.js`)

```js
export function lookup(node, opts = {}) {
  // 1. node 直接边(字段级:exact/value-match/fiber)优先
  // 2. 祖先回退:遍历,优先 fiber/exact/value-match 边;block 边不拦截,记最近 block 兜底,避免浅层 block 拦截深层 fiber
  // 3. opts.noFallback 关闭回退
}
```

避免浅层祖先 block 边(§7.5 整体 union 过近似)拦截深层 fiber 边(精确字段)。

`notifyUpdate()`:stampOrigin 盖戳完成后触发 overlay subscribe 回调,立即 scanHydration + paint,解决 fire-and-forget 异步盖戳晚于 render 的**刷新不一致**(不依赖 3s 轮询)。

---

## 9. overlay(`src/overlay.js`)

`paint()` 遍历 `allEdges()` 对有 data 边的 Element stampTitle(不依赖 `[data-wdpp-comp]` 标记,通用),hover 显示"WDPP 来源接口 + 字段路径 + 置信度 + 值样本"。

```
RANK = { exact: 6, declared: 5, fiber: 5, 'value-match': 4, control: 3, approx: 3, collision: 2, block: 1 }
```

---

## 10. React fiber hack(`src/component-bind.js` + `babel-runtime.js`)

- `getRootFiber(doc)`:遍历 body 子树找 `__reactContainer$` key(任意 root id,不 by case),缓存。
- `__readProp` 在 render 期把 `[obj,key]` 记到 `fiberReads` WeakMap(**fiber 不可扩展,React 18.3 实测,WeakMap 解决**)。
- `bindFiberCommit` commit 期按 fiber 定案字段边(§7.6 render 期记账,commit 期定案)。
- `__setRCO(getter)`:注入当前渲染 fiber getter(React 18 `__SECRET_INTERNALS.ReactCurrentOwner.current` / React 19 `__CLIENT_INTERNALS.A`)。

---

## 11. 刷新一致性(`src/stamp-origin.js` + `src/graph.js`)

`fetch` 拦截 `clone.text().then(stampOrigin)` 是 fire-and-forget 异步盖戳。修法:`stampOrigin` 根调用完成后调 `notifyUpdate()`(graph.js 新增),触发 overlay subscribe 的 scan 回调,立即 scanHydration + paint。验证:antd 两次 precision 100%/100% 一致。

---

## 12. 接线(测试项目接入)

| 接入点 | 改动 |
|---|---|
| `@wdpp` alias | `impl/l0/src`(antd: `@wdpp` -> `impl/l0/src`;rwa: `@wdpp` -> `impl/l0/src`) |
| babel 插件 | `extraBabelPlugins: [[scopedWdppPlugin, { l2: true }]]` (antd/rwa) 或 vite plugin (demo-react) |
| 排除 | `impl/l0/src` / `wdpp-runtime.js` / `runtime.js` (防自插桩递归) |
| wdpp-runtime.js | `Object.assign(globalThis, { __recover, __passthrough, __fieldGet, __aggr, __readProp, __readPropOptional, __fieldGetOptional, __controlAnd, __controlOr, __controlTernary, __controlReturn, __readSlot, __controlEnter, __controlExit })` + `__setRCO(getter)` + `install({ expose: true, overlay: true })` |

**不修改测试项目业务代码**(antd/rwa 的 `src/pages/...` 不改)。

---

## 13. 适用条件(任意 React 项目)

| 条件 | 说明 |
|---|---|
| React 16.8+ | fiber + hooks;`__reactContainer$` + `ReactCurrentOwner` |
| babel 插桩配置 | app 代码 L2;库不插 |
| 网络 fetch/XHR/WS/SSE/postMessage/JSON.parse | 标准 API |
| dev 模式 | fiber internals 非压缩 + overlay |
| 浏览器 DOM | patchAccessor |

**不适用**:非 React(prod/fiber 缺)、prod(待适配)、物理边界 canvas/WebGL(未实现,DESIGN.md §7.4 待做)、自定义协议 gRPC-Web(待扩展)、RSC 流式(部分覆盖)。

---

## 14. 限制(诚实)

1. **深拷贝**:已被 `__passthrough` 解决(per-object identity)。自定义深拷贝未识别降级 byVal(碰撞)。
2. **库内部变换**(valueEnum/dayjs):库未插桩,靠块级(props 带照对象)降级。
3. **低熵值**(status=0):值索引 miss,块级靠 byVal fieldMap(含 `__wdpp_fields` 字段位)。
4. **物理边界** canvas/WebGL/WebAudio:未实现,DESIGN.md §7.4 待做。
5. **SSR/RSC**:拦 `__NEXT_DATA__`,RSC 流式未覆盖。
6. **prod 构建**:fiber internals 可能 minify,dev 为主。
7. **序列化边界** Worker/IndexedDB:丢标(§12.8),postMessage 接收侧重盖。
8. **多输入并集**(`merge`/`concat`):result 带所有输入 identity(过近似 claim),但 identity 并集(taint 语义)非值碰撞。

---

## 15. 与第一性原理的差距(诚实)

- **byVal 是值反查**,违反 §1 "追踪 identity 不追踪 value"(已被 `__passthrough` 大幅替代,byVal 降级为兜底)。
- **未实现 Proxy identity 传播**(§5):仅在深拷贝递归(`copyIdentityDeep`)上实现身份传播,运行时未实现 Proxy。
- **物理边界未实现**(§7.4)。

---

## 16. 测试 + 真实 app 验证

### 16.1 conformance(98 + 6 = 104 全过)

| 文件 | 测试数 |
|---|---|
| `test/conformance.js` | 12 (L0 值索引) |
| `test/l1.conformance.js` | 6 (L1 变换恢复 + 控制边) |
| `test/dom.conformance.js` | 9 (DOM sink) |
| `test/p0-fixes.js` | 5 (compaction + chunked) |
| `test/protocol.conformance.js` | 13 (钩子) |
| `test/xhr.conformance.js` | 4 (XHR) |
| `test/jalangi.conformance.js` | 18 (断路子集) |
| `test/transform-parallel.conformance.js` | 7 (库变换 + 并行消歧) |
| `test/l1-precise.conformance.js` | 10 (L2 字段级) |
| `test/control-context.conformance.js` | 8 (控制上下文栈) |
| `test/universal-block.conformance.js` | 8 (通用块级 + 祖先回退) |
| `test/passthrough.conformance.js` | 6 (深拷贝 pass-through) |

### 16.2 真实 app 验证(`testbed-antd/verify/precision.mjs` + `testbed-rwa/verify/precision.mjs`)

| 项目 | React | precision | recall | 备注 |
|---|---|---|---|---|
| antd-pro(ant-design-pro) | 19.2 | **100%** | **100%** | 20 行 × 5 列(status 含低熵,通用块级正确归因) |
| rwa(cypress-realworld-app) | 18.2 | **88%** | **100%** | 10 笔 × 5 字段(like-count/comment-count 3 wrong 残留低熵碰撞) |

两项目均未改业务代码,只通过 `wdpp-runtime.js` + vite/umi babel 插件接入。

---

## 17. 文件清单(关键改动)

| 文件 | 改动 |
|---|---|
| `babel/plugin.js` | 14 visitor + DEEP_CLONE_FNS 白名单 + `isDeepCloneCall` + `__passthrough` helper |
| `src/babel-runtime.js` | `__passthrough` + `copyIdentityDeep` + `fiberReads` WeakMap(fiber 不可扩展) |
| `src/stamp-origin.js` | 网络拦截 + identity 盖戳 + `notifyUpdate` 触发 |
| `src/value-index.js` | 值索引 + objectIndex + 代际 + 熔断 |
| `src/sm.js` | SM 字段槽位(含低熵) |
| `src/dom-sink.js` | patchAccessor + onDomWrite + scanHydration 串接 bindFiberCommit + bindComponentData |
| `src/component-bind.js` | `bindComponentData`(通用块级) + `bindFiberCommit` + `getRootFiber` 通用化 |
| `src/graph.js` | lookup 祖先回退优先字段级 + `notifyUpdate` |
| `src/overlay.js` | paint allEdges(不依赖标记) |
| `src/control-index.js` | 控制栈 |
| `src/recovery.js` | `__recover` 库整体算子恢复 |
| `src/index.js` | `install({ expose: true, overlay: true })` 挂 `window.__wdpp__` |
| `demo-react/src/runtime.js` + `testbed-*/src/wdpp-runtime.js` | globalThis 注入 helper(含 `__passthrough`) |

# 详细设计:按图的架构与 Hack 清单

> 配套 `评审结果-纯图架构重定位(从按值追踪到血缘图引擎).md`。
> 本文件给出 Universal Taint Union + Graph Engine 的**具体实现设计**与**完整 Hack 清单**。
> 评议纪律(来自 memory):第一性原理、通用不 by case、精确做不到就诚实降级块级并标置信度。

---

## 0. 设计总览

### 0.1 一句话

**图是表达,union 是规则**。把 `Map<值, passport>` 中心改成"图(节点+边)中心",所有 input/output 边界统一应用 `provenance(output) = ∪ provenance(inputs)`,Layer 2/3 边界 fallback 不再需要 per-case。

### 0.2 核心原则

| 原则 | 表述 |
|---|---|
| **Universal Taint Union** | `output = f(inputs) → provenance(output) = ∪ provenance(inputs)` |
| **Block-level fall-back** | 精确做不到就 union 所有可能输入,标 🟡 union |
| **No per-case** | 不维护白名单外的特例(库、序列化等都用同一规则) |
| **Honest unknown** | 完全不可观测就标 ⚪ unknown,不假精确 |

### 0.3 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│ Graph Engine                                                 │
│   - 节点:ApiSource / Field / Operation / DomNode / Value    │
│   - 边:produces / derived-from / writes-to / conditional-by │
│   - 存储:邻接表 + 双向索引 + 可选 fast-path(值索引)        │
│   - 查询:BFS / DFS + 置信度过滤                             │
└─────────────────────────────────────────────────────────────┘
            ↑                ↑              ↑
┌───────────┴──┐    ┌────────┴──────┐  ┌───┴──────────┐
│ Producer     │    │ Transform     │  │ Sink         │
│  - fetch     │    │  - babel      │  │  - DOM 拦截  │
│  - XHR       │    │  - universal  │  │  - onDomWrite│
│  - WS/SSE    │    │    helpers    │  │  - MO 清理   │
│  - postMsg   │    │  - 7 新       │  │              │
│  - SSR       │    │    visitor    │  │              │
└──────────────┘    └───────────────┘  └──────────────┘
            ↑                ↑              ↑
            └────────────────┴──────────────┘
                              ↑
                    ┌─────────┴──────────┐
                    │ Hack Layer         │
                    │  - 边界拦截         │
                    │  - opaque 库白名单  │
                    │  - 序列化恢复       │
                    │  - 全局副作用兜底   │
                    │  - 物理边界(canvas)│
                    └────────────────────┘
```

---

## 1. 节点与边类型

### 1.1 节点类型(7 类)

| 类型 | 标识 | 来源 | 含义 |
|---|---|---|---|
| **ApiSource** | `api:{method}:{url}` | Producer | 网络端点(GET /users 等) |
| **Field** | `field:{api}:{jsonPath}` | Producer / Transform | 字段引用(`/users[].name) |
| **Operation** | `op:{type}:{seq}` | Transform | 一次运算/调用/赋值 |
| **ControlFrame** | `ctrl:{type}:{seq}` | Transform | 条件/循环上下文 |
| **Value** | `val:{ref}` | Transform / Sink | 运行时值(对象引用或原始值) |
| **DomNode** | `dom:{elementRef}` | Sink | DOM 节点/文本节点 |
| **Attribute** | `attr:{dom}:{name}` | Sink | DOM 属性 |

### 1.2 边类型(8 类)

| 边类型 | 起点 → 终点 | 含义 | 元数据 |
|---|---|---|---|
| **produces** | Operation → Value | 运算产生值 | transform type |
| **derived-from** | Value → Value | 派生(input → output) | confidence |
| **reads-from** | Operation → Field/Value | 读取字段/值 | location |
| **writes-to** | Value → DomNode/Attribute | 写入 DOM | attr name |
| **conditional-by** | Value → Value | 控制条件影响 | condition type |
| **field-of** | Field → Value/Object | 字段归属 | jsonPath |
| **attribute-of** | Attribute → DomNode | 属性归属 | attr name |
| **stamps** | ApiSource → Field | API 给字段盖戳 | stamp gen |

### 1.3 元数据(每节点/每边)

```ts
interface NodeMeta {
  id: string;                 // 唯一标识
  type: NodeType;             // 类型
  createdAt: number;          // 时间戳(运行时) / build time(静态)
  location?: SourceLoc;       // file:line:col 或 runtime pos
  confidence: 'exact' | 'value-match' | 'block' | 'collision' | 'union' | 'unknown';
  // exact: 单一来源精确; value-match: 多源但运行时匹配到; block: 块级 over-approx
  // collision: 多源碰值(值索引); union: 多源 union; unknown: 不可观测
  pass?: WeakRef<any>;        // 运行时引用(对象 / DOM)
}

interface EdgeMeta {
  from: NodeId;
  to: NodeId;
  type: EdgeType;
  confidence: Confidence;
  timestamp: number;
  seq: number;                // 写入序号(用于时序过滤)
  transform?: string;         // 变换类型(派生边)
}
```

### 1.4 节点 ID 规则

- **运行时**:stable ID = `${type}:${stable_ref_or_path}`
- **ApiSource**: `${method} ${url}` (strip query)
- **Field**: `${api}:${jsonPath}` (如 `GET /users:[].name`)
- **Operation**: 每次运算唯一 seq
- **DomNode**: weak ref + 元素路径

---

## 2. 存储层

### 2.1 图存储

```js
class Graph {
  // 节点表
  nodes = new Map<NodeId, NodeMeta>();
  
  // 邻接表(双向)
  forward = new Map<NodeId, Set<EdgeMeta>>();   // from → [edges]
  reverse = new Map<NodeId, Set<EdgeMeta>>();   // to → [edges]
  
  // 写入序号(用于时序)
  writeSeq = 0;
  
  addNode(meta) { ... }
  addEdge(from, to, type, confidence, extra) {
    const seq = ++this.writeSeq;
    const edge = { from, to, type, confidence, seq, ...extra };
    // ...
  }
  
  // 查询
  lookupDown(nodeId, opts) { ... }   // 正向 BFS
  lookupUp(nodeId, opts) { ... }     // 反向 BFS(用于 lookup DOM → API)
  queryField(fieldId, opts) { ... }  // 找字段的所有下游 DOM
  allEdges(opts) { ... }
}
```

### 2.2 索引层(fast-path)

| 索引 | 数据结构 | 用途 |
|---|---|---|
| **Value Index** | `Map<value, Set<FieldId>>` | DOM 写入时反查(同现行) |
| **Field Index** | `Map<jsonPath, FieldId>` | 字段 ID 反查 |
| **Stack Index** | `WeakMap<Fiber, Set<OperationId>>` | 当前 fiber 的活跃 operations |
| **Fiber Reads** | `WeakMap<Fiber, [[obj, key]]>` | render 期读取记录(同现行) |

**Value Index 作为 fast-path 保留**,但**不是 source of truth**。图是 source of truth,值索引是查询加速。

### 2.3 内存管理

- **LRU 驱逐**:Node 超过 N=10000 时驱逐最旧(保留最近活跃)
- **WeakRef DOM 节点**:DOM 节点 GC 时自动清理边(DESIGN.md §12.1)
- **Generation 切换**:长会话 bump gen,物理删除过期代 entries
- **熔断**:总内存超阈值(50MB)自动降级采样

---

## 3. Producer 层(API 入口)

### 3.1 网络拦截清单

| 原语 | 拦截方式 | 创建节点 |
|---|---|---|
| `fetch` | `globalThis.fetch` shim | ApiSource + Field 树 |
| `XMLHttpRequest` | `open` + `send` 拦截 | ApiSource + Field 树 |
| `WebSocket` | `addEventListener('message')` 拦截 | ApiSource + Field 树 |
| `EventSource` (SSE) | `addEventListener('message')` 拦截 | ApiSource + Field 树 |
| `postMessage` 接收侧 | `window.addEventListener('message')` | ApiSource + Field 树 |
| SSR `__NEXT_DATA__` | `defineProperty` + set trap | ApiSource + Field 树 |
| `JSON.parse` 重盖 | 已有护照的字符串 → 重盖 | 字段路径解析 |

### 3.2 stampOrigin 协议

```js
export function stampOrigin(obj, sourceId, path = [], visited = new WeakSet()) {
  if (!obj || typeof obj !== 'object') return;
  if (visited.has(obj)) return;
  visited.add(obj);
  
  const isArr = Array.isArray(obj);
  let allUnion = 0n;
  
  for (const [k, v] of Object.entries(obj)) {
    const seg = isArr ? '[]' : k;
    const fieldId = getFieldId(JSON.stringify([sourceId, ...path, seg]));
    
    // 1. 创建 Field 节点
    graph.addNode({
      id: `field:${sourceId}:${[...path, seg].join('.')}`,
      type: 'Field',
      confidence: 'exact',
    });
    
    // 2. 创建 stamps 边:ApiSource → Field
    graph.addEdge(apiSourceId, fieldId, 'stamps', 'exact', now);
    
    if (v !== null && typeof v === 'object') {
      // 3. 递归子对象
      const sub = stampOrigin(v, sourceId, [...path, seg], visited);
      smSet(obj, k, bit(fieldId) | sub);  // SM 字段槽位
      allUnion |= sub;
    } else {
      // 4. 盖戳值索引(fast-path)
      stampValue(v, fieldId);
      smSet(obj, k, bit(fieldId));
    }
    
    // 5. 字段位
    obj.__wdpp_fields = obj.__wdpp_fields || {};
    obj.__wdpp_fields[k] = bit(fieldId);
  }
  
  // 6. 值索引兜底(深拷贝场景)
  if (!isArr) stampByVal(obj);
  
  return allUnion;
}
```

**关键变化**:`stampOrigin` 不仅是盖值索引,**还要建图节点和边**。

---

## 4. Transform 层(babel + runtime helpers)

### 4.1 Universal Helper 抽象

```js
// 所有具体 helper 的内部实现
export function __taint(result, inputs, type, confidence = 'exact') {
  if (result === null || result === undefined) return result;
  
  // fast-path: 无 inputs taint
  const taints = inputs.filter(i => i != null).map(getTaint).filter(Boolean);
  if (!taints.length) return result;
  
  // 1. 创建 Operation 节点
  const opId = `op:${type}:${++seq}`;
  graph.addNode({ id: opId, type: 'Operation', location: currentLoc() });
  
  // 2. 创建 produces 边:Op → result
  graph.addEdge(opId, getValueId(result), 'produces', confidence);
  
  // 3. 创建 derived-from 边:result ← inputs
  const union = taints.reduce((a, b) => a | b, 0n);
  for (const t of taints) {
    graph.addEdge(getValueId(result), t, 'derived-from', confidence);
  }
  
  // 4. 应用 union 到 value(fast-path 索引)
  stampValuePassport(result, union);
  
  return result;
}
```

### 4.2 具体 Helpers(完整清单)

| Helper | 用途 | AST 节点 | 应用规则 |
|---|---|---|---|
| `__recover(result, inputs)` | 函数调用 | `CallExpression` | 库作整体算子 |
| `__passthrough(result, inputs)` | 深拷贝 | `CallExpression` (cloneDeep 等) | 递归复制身份 |
| `__aggr(container)` | 对象/数组字面量 / spread | `ObjectExpression` / `ArrayExpression` / `SpreadElement` | 成员并集 |
| `__writeField(obj, key, value)` | 字段写 | `MemberExpression` as assignment target | field taint 继承 value |
| `__deleteField(obj, key)` | 字段删 | `DeleteExpression` | 移除 field taint |
| `__readSlot(obj, key)` | 解构 / 计算式读 | `ObjectPattern` / `MemberExpression` (computed) | field 护照 |
| `__controlAnd(condVal, condPassport, rightFn)` | `a && b` | `LogicalExpression` `&&` | 控制边 + 右值 |
| `__controlOr(condVal, condPassport, rightFn)` | `a \|\| b` | `LogicalExpression` `\|\|` | 控制边 + 右值 |
| `__controlTernary(condVal, condPassport, aFn, bFn)` | `a ? b : c` | `ConditionalExpression` | 控制边 + 选中支 |
| `__nullish(a, b, aTaint, bTaint)` | `a ?? b` | `NullishCoalescingExpression` | 选中值 taint |
| `__throw(value)` | `throw x` | `ThrowStatement` | 抛出值 taint 保留 |
| `__await(promise, value)` | `await x` | `AwaitExpression` | Promise resolve taint |
| `__optionalChain(obj, key, isNullish)` | `a?.b` | `OptionalMemberExpression` / `OptionalCallExpression` | nullish 短路 + field |
| `__taggedTemplate(tag, args, strings)` | `` tag`${x}` `` | `TaggedTemplateExpression` | tag 函数参数 taint |
| `__recoverSelf(result, prev)` | `x = expr` | `AssignmentExpression` (Identifier) | result 继承 prev + expr |
| `__readProp(obj, key)` | 全量属性读 | `MemberExpression` (L2) | 字段护照 + 渲染 fiber 记账 |

### 4.3 Babel Plugin Visitor 完整清单

**现有 14 个**(在 `impl/l0/babel/plugin.js`):

| AST 节点 | Helper | 状态 |
|---|---|---|
| `BinaryExpression` (`+ - * /`) | `__recover(a op b, [a, b])` | ✅ |
| `TemplateLiteral` | `__recover(\`...${a}\`, [a])` | ✅ |
| `CallExpression` (普通) | `__recover(fn(a), [a])` | ✅ |
| `CallExpression` (深拷贝) | `__passthrough(fn(a), [a])` | ✅ |
| `MemberExpression` (动态 key) | `__fieldGet(obj, key)` | ✅ |
| `MemberExpression` (静态 key, L2) | `__readProp(obj, 'key')` | ✅ |
| `__recover` / `__passthrough` / `__aggr` | 裸标识符(不重入) | ✅ |
| `if` / `Loop` / `Switch` | `__controlEnter` + `__controlExit` | ✅ |

**新增 7+ 个**(Universal Taint Union 完整覆盖):

| AST 节点 | Helper | 优先级 |
|---|---|---|
| `AssignmentExpression` (Identifier) `x = y` | `__recoverSelf(x, y)` | 高 |
| `MemberExpression` 写 `obj.x = y` | `__writeField(obj, 'x', y)` | **最高** |
| `ObjectPattern` 解构 `const {a} = obj` | `__readSlot(obj, 'a')` | 高 |
| `ArrayPattern` 解构 `const [a, b] = arr` | `__readSlot(arr, '0')` | 中 |
| `VariableDeclarator` `const x = obj.a` | `__readProp(obj, 'a')` | 中 |
| `ThrowStatement` `throw x` | `__throw(x)` | 中 |
| `OptionalMemberExpression` `a?.b` | `__optionalChain(a, 'b')` | 中 |
| `NullishCoalescingExpression` `a ?? b` | `__nullish(a, b, aTaint, bTaint)` | 中 |
| `DeleteExpression` `delete obj.x` | `__deleteField(obj, 'x')` | 中 |
| `TaggedTemplateExpression` `` tag`${x}` `` | `__taggedTemplate(tag, [x])` | 低 |
| `ClassProperty` `class { x = y }` | `__recoverSelf(this.x, y)` | 低 |
| `AwaitExpression` `await x` | `__await(promise, x)` | 低 |
| `UpdateExpression` `x++` | (无需覆盖,自循环) | - |

### 4.4 Babel Plugin 实现草案

```js
// babel/plugin.js 扩展

// 1. MemberExpression 写:obj.x = y
function isMemberWrite(path) {
  const parent = path.parentPath;
  return parent.isAssignmentExpression() && parent.node.left === path.node;
}

// 2. AssignmentExpression: x = y (Identifier only)
function isSimpleAssign(path) {
  return path.isAssignmentExpression() && t.isIdentifier(path.node.left);
}

// 3. ObjectPattern 解构
function isObjectPattern(path) {
  return path.isObjectPattern();
}

// ... visitor 注册
const visitors = {
  // ... 现有 visitor ...
  
  // 新增
  AssignmentExpression(path) {
    if (!isSimpleAssign(path)) return;
    const { left, right } = path.node;
    path.replaceWith(
      t.expressionStatement(
        t.callExpression(t.identifier('__recoverSelf'), [
          left, right
        ])
      )
    );
  },
  
  MemberExpression(path) {
    if (!isMemberWrite(path)) return;  // 现有读 visitor 处理
    const obj = path.node.object;
    const key = path.node.computed ? path.node.property : t.stringLiteral(path.node.property.name);
    const value = path.parentPath.node.right;
    path.parentPath.replaceWith(
      t.callExpression(t.identifier('__writeField'), [
        obj, key, value
      ])
    );
  },
  
  ObjectPattern(path) {
    // const { a, b } = obj → const a = obj.a; const b = obj.b;
    const declarations = path.node.properties.map(prop => {
      const key = prop.key.name || prop.key.value;
      return t.variableDeclarator(
        prop.value,
        t.callExpression(t.identifier('__readSlot'), [
          t.identifier('obj'), t.stringLiteral(key)
        ])
      );
    });
    // ... emit
  },
  
  ThrowStatement(path) {
    const arg = path.node.argument;
    if (!arg) return;
    path.replaceWith(
      t.throwStatement(
        t.callExpression(t.identifier('__throw'), [arg])
      )
    );
  },
  
  // ... 其他 visitor
};
```

---

## 5. Sink 层(DOM 写入)

### 5.1 DOM 拦截清单

| 原语 | 拦截方式 | 边类型 |
|---|---|---|
| `CharacterData.nodeValue` | patchAccessor | writes-to |
| `CharacterData.data` | patchAccessor | writes-to |
| `Node.textContent` | patchAccessor | writes-to |
| `Element.innerHTML` | patchAccessor (set trap) | writes-to (html) |
| `Element.setAttribute` | shim | writes-to (attr) |
| `Element.className` | patchAccessor | writes-to (class) |
| `Element.id` / `Element.title` | patchAccessor | writes-to |
| `HTMLInputElement.value` | patchAccessor | writes-to |
| `HTMLInputElement.checked` | patchAccessor | writes-to |
| `HTMLImageElement.src` | patchAccessor | writes-to |
| `HTMLAnchorElement.href` | patchAccessor | writes-to |
| `HTMLInputElement.placeholder` / `disabled` | patchAccessor | writes-to |
| `HTMLOptionElement.selected` | patchAccessor | writes-to |
| `CSSStyleDeclaration.setProperty` | shim | writes-to (style.X) |
| `document.createTextNode` | shim | writes-to |

### 5.2 onDomWrite(图查询)

```js
function onDomWrite(node, value, attrName) {
  if (value == null) return;
  const v = typeof value === 'object' ? String(value) : value;
  
  // 1. 图查询:值 → 字段
  const taint = queryGraphForValue(v);  // 返回 Set<FieldId>
  
  // 2. 相邻文本拼接救
  if (!taint && isTextNode(node)) {
    const concat = tryConcatAdjacent(node);
    if (concat) taint.add(concat);
  }
  
  // 3. 控制边
  const ctrls = controlGet(v);
  const stack = getControlStack();
  
  if (!taint && !ctrls.length && !stack.length) return;  // 字面量
  
  // 4. 清理旧边
  clearEdges(node);
  
  // 5. 建图边:Value → DomNode
  const domId = `dom:${getNodeRef(node)}`;
  graph.addNode({ id: domId, type: 'DomNode', pass: new WeakRef(node) });
  
  for (const fieldId of taint) {
    const conf = getConfidence(fieldId);  // exact / value-match / collision
    graph.addEdge(getValueId(v), domId, 'writes-to', conf, now, { attr: attrName });
  }
  
  // 6. 控制边
  for (const c of ctrls) {
    for (const id of expandBits(c.passport)) {
      graph.addEdge(getValueId(v), domId, 'conditional-by', c.conf, now, { attr: attrName });
    }
  }
}
```

### 5.3 MutationObserver(清理)

```js
const mo = new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.removedNodes) {
      // 清理 DomNode 节点 + 关联边
      clearEdges(n);
    }
  }
});
mo.observe(document, { childList: true, subtree: true });
```

---

## 6. Query 层

### 6.1 lookup(DOM → API)

```js
export function lookup(node, opts = {}) {
  const domId = getDomNodeId(node);
  if (!domId) return [];
  
  // 1. 直接边优先
  const direct = graph.reverse.get(domId);
  if (direct?.size) {
    return [...direct].map(formatEdge);
  }
  
  if (opts.noFallback) return [];
  
  // 2. 祖先回退:反向 BFS 找祖先 DomNode
  let cur = node?.parentElement;
  const MAX = 32;
  let blockOut = null;
  while (cur && MAX--) {
    const curId = getDomNodeId(cur);
    const r = graph.reverse.get(curId);
    if (r?.size) {
      const hi = [];
      let lo = [];
      for (const e of r) {
        const item = formatEdge(e);
        if (e.confidence === 'block') lo.push(item);
        else hi.push(item);
      }
      if (hi.length) return hi;
      if (!blockOut && lo.length) blockOut = lo;
    }
    cur = cur.parentElement;
  }
  return blockOut || [];
}
```

### 6.2 queryField(API → DOM)

```js
export function queryField(fieldId, opts = {}) {
  // 正向 BFS:Field → 派生 Value → 写入的 DomNode
  const visited = new Set();
  const result = [];
  const queue = [fieldId];
  
  while (queue.length) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    
    const edges = graph.forward.get(id);
    if (!edges) continue;
    
    for (const e of edges) {
      if (opts.since !== undefined && e.seq < opts.since) continue;
      result.push(formatEdge(e));
      queue.push(e.to);
    }
  }
  
  return result;
}
```

### 6.3 allEdges / visualize

```js
export function allEdges() {
  const out = [];
  for (const [, edges] of graph.forward) {
    for (const e of edges) out.push(formatEdge(e));
  }
  return out;
}

export function visualize() {
  // 输出 DOT / JSON 给 DevTools
}
```

---

## 7. Hack 清单(按断点分类)

### 7.1 Babel Plugin 缺口(7+ AST visitor)

**已在 §4.3 列完整清单**。这是 universal taint union 覆盖不全的部分,**hack 方式是按 AST 类型 emit 对应 helper 调用**。

### 7.2 库边界(Opaque Library)

**断点**:库内部未插桩,数据进入/出库时 taint 丢失。

**Hack**:
```js
// babel plugin: CallExpression visitor 已有 __recover
const formatted = dayjs(u.createdAt).format('YYYY-MM-DD');
// 编译为:
const _result = __recover(dayjs(u.createdAt).format('YYYY-MM-DD'), [u.createdAt]);
// _result 继承 u.createdAt 的 taint (= /users.createdAt)
```

**结果**:graph 边 `Operation(dayjs.format) → Value(formatted)` with `derived-from /users.createdAt`。

**覆盖**:✅ 所有函数调用入口(universal)。

**例外**:库**内部**运算(`dayjs(x).format()` 内部 `_format()` 等)不产生图边——**但这是设计取舍**:边界 taint union 已保,内部不细分(规则 5 opaque 语义)。

### 7.3 序列化(JSON / postMessage / IndexedDB)

**断点**:序列化克隆新对象,WeakMap 全部断。

**Hack**:
```js
// 1. JSON.parse(JSON.stringify(x))  → __passthrough
//    编译时识别,递归复制 src identity 到 dst(per-object, 不碰撞)

// 2. structuredClone(x) → __passthrough
//    编译时识别,同 #1

// 3. cloneDeep / deepCopy / deepcopy → __passthrough
//    白名单 + 编译时识别

// 4. localStorage / sessionStorage
//    序列化路径已覆盖(parse 时识别已有护照字符串)

// 5. postMessage
//    接收侧 addEventListener('message') 拦截,__passthrough 接收 data

// 6. IndexedDB
//    get / getAll 拦截,识别 value 是否带护照字符串 → __passthrough
```

**结果**:图边 `Operation(passthrough) → Value(dst)` with `derived-from src.fields` (per-field)。

### 7.4 异步 / Promise

**断点**:Promise.then 回调在 microtask 执行,异步上下文丢失。

**Hack**:
```js
// 1. await x
//    编译: const _v = __await(x);  // 包装 await,result = resolve value,带 taint

// 2. promise.then(cb) / promise.catch(cb)
//    编译: __passthrough(promise.then(cb), [promise])
//    cb 参数在 babel 内部已用 __readProp 处理

// 3. async function
//    函数返回值隐式被 Promise.resolve 包装
//    __recover 在 return 处已经应用,return 的值带 taint

// 4. setTimeout / setInterval / queueMicrotask
//    回调函数参数走 __recover(call, [args])
```

**结果**:图边保留异步链的 taint 关系。

### 7.5 控制流(if / while / for / 三元 / 短路)

**断点**:条件分支选中的值,需要标"条件参与了"。

**Hack**:
```js
// 1. {cond && X} → __controlAnd
const visible = cond && user.name;
// 编译: __controlAnd(cond, condTaint, () => user.name)
//   - 控制边:visible.conditional-by ← cond
//   - 数据边:visible 继承 user.name 的 taint

// 2. {cond || X} → __controlOr
// 3. {cond ? X : Y} → __controlTernary
// 4. {a ?? b} → __nullish
// 5. if (cond) { x = y } → __controlEnter/Exit + 块内 taint 传播
```

**结果**:控制边 `DomNode ← Value(selected) ← ControlFrame(cond)`。

### 7.6 对象突变(关键 hack)⚠️

**断点**:`obj.x = y` 时,field taint 没继承 `y` 的 taint。

**Hack**:
```js
// Babel: MemberExpression 写 → __writeField
// 原始:  obj.status = newStatus;
// 编译:  __writeField(obj, 'status', newStatus);

// __writeField 实现
export function __writeField(obj, key, value) {
  const result = obj[key] = value;  // 原始赋值
  
  // 1. 读 value 的 taint
  const valueTaint = getTaint(value);
  
  // 2. 更新 obj.__wdpp_fields[key] = valueTaint
  if (valueTaint) {
    obj.__wdpp_fields = obj.__wdpp_fields || {};
    obj.__wdpp_fields[key] = valueTaint;
    
    // 3. 更新 SM 槽位
    smSet(obj, key, valueTaint);
    
    // 4. 建图边
    const fieldId = `field:${currentApi}:${getPath(obj)}.${key}`;
    graph.addEdge(getValueId(value), fieldId, 'produces', 'exact');
  }
  
  return result;
}
```

**结果**:field taint 在 mutation 后正确,后续读 `obj.status` 拿到正确的字段护照。

### 7.7 解构(关键 hack)⚠️

**断点**:`const { a, b } = obj` 时,`a` 和 `b` 不继承 `obj.a` / `obj.b` 的 taint。

**Hack**:
```js
// Babel: ObjectPattern → 展开为多个 __readSlot
// 原始:  const { a, b } = obj;
// 编译:  const a = __readSlot(obj, 'a');
//        const b = __readSlot(obj, 'b');

// __readSlot 实现
export function __readSlot(obj, key) {
  const v = obj[key];
  const slot = smGet(obj, key);  // 字段护照
  if (slot && v != null) {
    stampValuePassport(v, slot);  // 把字段护照传给值
  }
  return v;
}
```

**结果**:解构出的变量正确带字段 taint。

### 7.8 WASM / Native code

**断点**:WASM 内部完全黑盒。

**Hack**:
```js
// Babel: 普通 CallExpression → __recover
// 原始:  const result = wasmModule.process(buf);
// 编译:  const result = __recover(wasmModule.process(buf), [buf]);
//   result 继承 buf 的 taint(over-approx: 假设所有输入都流过)
```

**结果**:图边 `Operation(wasm.process) → Value(result)` with `derived-from buf.taint`。

**限制**:WASM 内部运算不细分(opaque)。**这是信息论上限**。

### 7.9 eval / Function 构造器

**断点**:eval 内部代码不经过 babel。

**Hack**:
```js
// 运行时 shim: eval
const _eval = globalThis.eval;
globalThis.eval = function(code) {
  const result = _eval.call(this, code);
  // 把 code 的 taint union 给 result
  return __recover(result, [code]);
};

// Babel: new Function(...) 类似
```

**结果**:eval 结果继承 code 的 taint(over-approx)。

### 7.10 Proxy / 反射

**断点**:Proxy 的 get trap 内可能引入新来源。

**Hack**:
```js
// 在 Proxy get trap 内,如果引入新值,手动包 __recover
new Proxy(target, {
  get(t, k) {
    const v = customLogic(t, k);
    // 如果 v 是新值(非 t[k]),且引入新来源 → 包 __recover
    return v === t[k] ? v : __recover(v, [t, k]);
  }
});
```

**限制**:用户写 Proxy 时需手动标注,**不是自动**。但 target 路径的 taint 通过 WeakMap 已保。

### 7.11 全局副作用 / 模块单例

**断点**:数据经全局变量流动,无显式数据流。

**Hack**:
```js
// 1. 写全局时 __aggr
//    cached = await fetch('/users').then(r => r.json());
//    cached = __aggr(cached);

// 2. 读全局时 __readSlot
//    const users = cached;
//    → __readSlot(globalThis, 'cached')

// 3. 静态分析兜底(flow-insensitive union)
//    编译期扫:globalThis.cached 的所有写者,union 作读取 taint
//    运行时无法精确,但 over-approx 兜底
```

**结果**:全局路径 over-approx 但 sound(不漏浅层)。

### 7.12 跨 Realm(iframe / Worker)

**断点**:不同 realm 有不同的 globalThis / WeakMap。

**Hack**:
```js
// 1. postMessage 边界:接收侧 addEventListener('message')
//    已在 §7.3 覆盖

// 2. iframe.contentWindow.someVar
//    读时 __recover(someVar, [iframe.contentWindow])

// 3. SharedWorker / ServiceWorker
//    postMessage 边界已覆盖
```

**结果**:跨 realm 的 taint 通过边界传递。

### 7.13 物理边界(Canvas / WebGL / Web Audio)

**断点**:DOM 视角下不透明(canvas/WebGL 输出是像素,无文本节点)。

**Hack**(来自 DESIGN.md §7.4):
```js
// CanvasRenderingContext2D 绘制方法拦截
const draws = ['fillText', 'drawImage', 'fill', 'stroke', 'arc', ...];
for (const fn of draws) {
  const orig = CanvasRenderingContext2D.prototype[fn];
  CanvasRenderingContext2D.prototype[fn] = function (...args) {
    const labels = args.map(getTaint).filter(Boolean);
    if (labels.length) canvasTaintOf(this.canvas).union(...labels);
    return orig.apply(this, args);
  };
}

// 以 rAF 边界为一个 unit,frame 末 seal 并写 canvas.dataset.provenance
```

**结果**:canvas 元素自身带 taint(单元内绘制输入的并集),DOM 写入时 `canvas` 节点带 taint。

### 7.14 低熵值碰撞

**断点**:值索引对 `0` / `1` / `''` 等黑名单跳过。

**Hack**:**不再依赖值作为唯一索引**——直接查图。

```js
// onDomWrite 内
function queryGraphForValue(value) {
  // 1. fast-path: 值索引(原有逻辑)
  let taint = getStamp(value);
  
  // 2. low-entropy fallback: 查 Operation 节点
  //    最近的操作(在 fiberReads / controlStack 中)也带上 taint
  if (!taint || taint.collision) {
    const stackTaint = getControlStackTop();
    if (stackTaint) taint = stackTaint;
  }
  
  // 3. fiber reads: 当前 fiber 的字段读取
  const f = getCurrentFiber();
  if (f) {
    const reads = getFiberReads(f);
    if (reads) taint = unionTaints(reads);
  }
  
  return taint;
}
```

**结果**:低熵值也能通过 fiber 读取或控制栈拿到 taint(over-approx)。

### 7.15 第三方组件库(antd / MUI / Element)

**断点**:库内部未插桩,props 流向 DOM 时 taint 丢失。

**Hack**(通用块级归因,**不 by case**):
```js
// component-bind.js 已有 bindComponentData
// 改动:扫描 props → 识别数据源(对象带 __wdpp_fields) →
//        外层 host 归 union

// __wdpp_fields 是 Layer 1 主追踪的产物,在 props 引用上保留
// antd <Table dataSource={users} />:
//   - users 对象有 __wdpp_fields = { '0': bit, '1': bit, ... }
//   - scan 识别,Table 整 host → union(users.__wdpp_fields)
//   - 图边:Field → DomNode (Table) with confidence 'block'
```

**结果**:库渲染的 DOM 块级归因,粒度 = 块,**不过细**(符合 memory 铁律)。

**改进路径**:细到行级需库配合(data-row-key 等),见 DESIGN.md §7.5 档 2(结构适配器)。

---

## 8. 实施路径(P1-P5)

### P1 核心数据结构迁移(2-3 周)

- 把 `Map<value, passport>` 中心改为 Graph 中心
- 保留 value index 作为 fast-path
- 节点/边类型定义 + Graph class 实现
- migrate stampOrigin 输出同时建图

### P2 Universal Taint Union helpers(2-3 周)

- 实现 §4.2 完整 helper 列表
- 每个 helper 走 __taint 内部
- 增加 unit test(每个 helper 独立)

### P3 Babel Plugin 扩展(2-3 周)

- 实现 §4.3 7+ 新 visitor
- 现有 14 visitor 验证不破坏
- integration test(完整编译流程)

### P4 真实 app 验证(2 周)

- antd / rwa 测试床跑通
- precision / recall 对比(目标:不降低)
- 找出剩余断点

### P5 Hack 清单补全(2-4 周)

- 按 §7 优先级实现各 hack
- 每个 hack 单独 conformance test
- 边界 case 鲁棒性

### 总周期:10-15 周

---

## 9. 限制与边界

### 9.1 不可达(信息论上限)

- **100% precision**(同值不同源,只能 over-approx)
- **WASM / native 内部运算**(无 API 可见)
- **eval 内部代码**(无 AST 可分析)
- **minified 库内部**(无源码)

### 9.2 可达但代价高

- **行级 / cell 级 did**(需 fiber 精确匹配)
- **跨请求 diff / replay**(需时序索引)
- **大数据集(千行表格)的字段级精度**(需额外优化)

### 9.3 永远诚实标 ⚪ 的场景

- **完全不可观测的代码**(无任何 hook 点)
- **物理边界内的精确语义**(canvas 内绘制什么)
- **服务端数据**(SSR 后丢失标签)

---

## 10. 性能预算

| 操作 | 当前 | 目标 | 缓解 |
|---|---|---|---|
| DOM 写入拦截 | 26-195ns | < 200ns | fast-path + 图 lazy |
| babel 编译 | ~1s/1000 行 | < 2s/1000 行 | 增量编译 |
| 内存(provenance) | 6 field + compaction | < 10MB / session | LRU + gen compaction |
| Lookup 查询 | O(1) | O(degree) BFS | 通常 < 10 跳 |
| antd 真实 app | 100%/100% | ≥ 100%/100% | 测试床验证 |

---

## 11. 与现有测试/资产的关系

| 现有资产 | 新设计中的角色 |
|---|---|
| 104 conformance 测试 | **保留**——验证 universal taint union 不退化 |
| antd/rwa 测试床 | **保留**——P4 验证 |
| `impl/l0/src/*` | **改造**——Graph 替换 Map,helpers 扩展 |
| `impl/l0/babel/plugin.js` | **扩展**——加 7+ visitor |
| `DESIGN-STATIC.md` | **并行可选**——audit / lint 工具 |

---

## 12. 文档清单

- ✅ `评审结果-纯图架构重定位(从按值追踪到血缘图引擎).md`:meta-review,讨论轨迹
- ✅ `详细设计-按图架构与hack清单.md`:本文件
- 📝 `impl/l0/src/graph.js`:Graph 类实现(P1 产出)
- 📝 `impl/l0/src/babel-runtime.js`:universal helpers(P2 产出)
- 📝 `impl/l0/babel/plugin.js`:新 visitor(P3 产出)
- 📝 `test/universal-taint.conformance.js`:测试(P2/P3 产出)


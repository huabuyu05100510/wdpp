# 深入浅出 WDPP:从一行 console.log 到生产级运行时血缘引擎

> **目标读者**:刚毕业 / 入行 1-2 年的前端工程师
> **前置知识**:懂 JS 基础 / 看过 React / 调过 API 即可
> **读完后能做什么**:能说出 WDPP 在做什么 / 能自己写一个 200 行的迷你版

---

## 0. 一个让你睡不着的问题

你写了一个页面:

```javascript
function UserCard({ userId }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`/api/user/${userId}`)
      .then(r => r.json())
      .then(data => setUser(data));
  }, [userId]);

  return <h1>{user?.name}</h1>;
}
```

突然产品经理走过来:

> "这个 `user.name` 是从哪个接口字段算出来的?如果是后端字段名改了,我怎么知道改了什么?"

你打开 DevTools,看到 DOM 上是 `Alice` 这个字符串。

```
h1.textContent = "Alice"
```

但 `Alice` 是 `api/user/42` 接口的 `data.name` 字段,还是 `api/user/42` 的 `data.userName` 字段,还是 `api/profile` 的 `data.displayName`?

**屏幕上只显示"Alice",完全无法回溯。**

这就是 WDPP 要解决的问题:**把屏幕上的"Alice"和接口里的"name"字段之间的关系,记下来。**

---

## 1. 一个最朴素的想法

**最直白的实现**:在 fetch 响应里加一段代码,在 DOM 写入时加一段代码,中间关联起来。

```javascript
// Step 1:API 响应时,记录每个字段
fetch('/api/user/42').then(r => r.json()).then(data => {
  Object.entries(data).forEach(([key, value]) => {
    fieldMap.set(value, `api/user/42.${key}`);
    // "Alice" → "api/user/42.name"
  });
});

// Step 2:DOM 写入时,反查字段
h1.textContent = 'Alice';
const source = fieldMap.get('Alice');
console.log(source);  // "api/user/42.name"
```

这能工作!但有几个问题:

1. **碰撞**:如果两个接口都有 `"Alice"`,我们只能用最后注册的覆盖前面。
2. **低熵值**:`0`/`1`/`true`/`false` 等几乎每个接口都有,会冲突爆炸。
3. **变换**:`user.name.toUpperCase()` 后,DOM 是 `"ALICE"`,跟原始 `"Alice"` 对不上。
4. **嵌套**:`user.profile.name`,需要逐层盖戳。

我们一一解决。

---

## 2. 第一个核心数据结构:Map<值, 多个字段>

解决碰撞问题:**一个值可能对应多个字段,用 Set 而不是覆盖**。

```javascript
const fieldMap = new Map();  // 值 → Set<字段路径>

function stampField(value, path) {
  if (!fieldMap.has(value)) {
    fieldMap.set(value, new Set());
  }
  fieldMap.get(value).add(path);
}

// 现在
stampField('Alice', 'api/user/42.name');
stampField('Alice', 'api/profile/displayName');
fieldMap.get('Alice');  // Set { 'api/user/42.name', 'api/profile/displayName' }
```

DOM 写入时,反查即可得到所有可能的字段来源。这就是 WDPP 的"值索引"——`Map<原始值, Set<字段路径>>`。

---

## 3. 处理低熵值:黑名单

`0`、`1`、`true`、`false`、`""`、`null` 这些值**几乎任何接口都有**。如果都进索引,会碰撞爆炸。

**解决办法**:直接拒绝低熵值进索引。

```javascript
const LOW_ENTROPY = new Set([true, false, 0, 1, '', null, undefined]);

function stampField(value, path) {
  if (LOW_ENTROPY.has(value)) return;  // 直接跳过
  // ...
}
```

**代价**:低熵值的血缘丢失。比如接口返回 `{ isVip: true }`,这个 `true` 无法反查到字段。

**WDPP 的 hack**:低熵值走另一条通道——"Shadow Memory"(SM)。我们不是查值,而是**记在对象的字段上**:

```javascript
const shadowMemory = new WeakMap();  // 对象 → 字段 → 字段位

function smSet(obj, key, fieldBit) {
  if (!shadowMemory.has(obj)) shadowMemory.set(obj, new Map());
  shadowMemory.get(obj).set(key, fieldBit);
}

function smGet(obj, key) {
  return shadowMemory.get(obj)?.get(key) || 0n;
}
```

用法:

```javascript
const data = { isVip: true };
// API 响应盖戳时
smSet(data, 'isVip', fieldBit);
// 后续读 data.isVip
if (smGet(data, 'isVip')) {
  // 知道 isVip 字段有血缘,虽然 true 本身在黑名单
}
```

**这是 WDPP 的"双通道"**:
- **值索引**:高熵值(字符串、长数字),按值反查
- **Shadow Memory**:低熵值,按对象+字段反查

---

## 4. 处理类型归一化:数字 vs 字符串

API 返回 `{ level: 7 }`(数字),但 DOM 显示可能是 `"7"`(字符串)。`7 !== "7"`,值索引查不到!

**解决**:数字同时存原值和 `String(value)`:

```javascript
function keysFor(value) {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return [value, String(value)];  // 7 → ['7', 7]
  }
  return [value];  // 'Alice' → ['Alice']
}

function stampField(value, path) {
  for (const key of keysFor(value)) {
    // 同时索引 7 和 '7'
    if (!fieldMap.has(key)) fieldMap.set(key, new Set());
    fieldMap.get(key).add(path);
  }
}
```

现在 DOM 写 `"7"` 时也能查到字段位。

---

## 5. 处理变换:`toUpperCase()` 后还能反查吗?

```javascript
const data = { name: 'Alice' };
const display = data.name.toUpperCase();  // 'ALICE'
h1.textContent = display;
```

`'Alice'` 在值索引里,但 `'ALICE'` 不在,反查失败。

**解决:Babel 编译期插桩**

我们改业务代码,让所有"产生新值"的运算都调用一个 helper:

```javascript
// 源码
const display = data.name.toUpperCase();

// Babel 编译后
const display = __recover(data.name.toUpperCase(), [data.name]);
//                     ^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^
//                     原表达式(保留原值)             原输入(传递 taint)
```

`__recover` 内部:

```javascript
function __recover(result, inputs) {
  // result 是运算结果,inputs 是运算输入
  for (const input of inputs) {
    const sourceFields = fieldMap.get(input);
    if (sourceFields) {
      // 把 sourceFields 的字段位合并到 result
      const resultFields = fieldMap.get(result) || new Set();
      for (const f of sourceFields) resultFields.add(f);
      fieldMap.set(result, resultFields);
    }
  }
  return result;
}
```

现在 `'ALICE'` 也有 `'api/user/42.name'` 的字段位。

### 5.1 万一 Babel 太重?还有 monkey-patch 模式

如果你不愿意/不能改业务代码(比如老项目、不能用 Babel 的项目),WDPP 还提供"零侵入"模式——劫持原生方法:

```javascript
const _toUpperCase = String.prototype.toUpperCase;
String.prototype.toUpperCase = function () {
  const r = _toUpperCase.call(this);
  __recover(r, [this]);  // 自动传递 taint
  return r;
};
```

这样 `name.toUpperCase()` 自动带 taint,**业务代码零修改**。

---

## 6. 处理条件边:`{cond && X}` 怎么办?

```javascript
const visible = isVip && user.name;
// 当 isVip 为 false,visible = false,没有 user.name 血缘
// 当 isVip 为 true,visible = user.name,既有 user.name 血缘,也有 isVip 控制边
```

**解法**:`{cond && X}` 编译为 `__controlAnd(cond, condTaint, () => X)`,产生两条边:
- **数据边**:`visible` 继承 `X` 的字段位
- **控制边**:`visible` 受 `cond`(的字段位)影响

```javascript
function __controlAnd(cond, condTaint, getRight) {
  if (cond) {
    const r = getRight();
    // 数据边:r 的字段位
    const rFields = fieldMap.get(r);
    if (rFields) fieldMap.set(visible, rFields);
    // 控制边:visible 受 condTaint 影响
    controlEdges.push({ to: visible, type: 'control', from: condTaint });
    return r;
  }
  return cond;
}
```

控制边用 `condTaint`(cond 的字段位)。这样,UI 上既显示"visible 来自 user.name",也显示"visible 受 isVip 控制"。

类似还有:
- `cond || X` → `__controlOr`
- `cond ? a : b` → `__controlTernary`
- `if (cond) { ... }` → `__controlEnter + body + __controlExit`(整段体都受 cond 控制)

---

## 7. 核心数据结构:值索引 + 控制边 + SM

到目前为止,我们有三个核心数据结构:

```
1. 值索引:Map<原始值, Set<字段路径>>
   → DOM 写入时按值反查

2. Shadow Memory:WeakMap<对象, Map<字段, 字段位>>
   → 低熵值按对象+字段反查

3. 控制边:Array<{to: DOM节点, from: 字段位, type: 'control'}>
   → 标注 DOM 受哪些字段影响
```

加上 `Map<字段路径, 字段位>`(字段注册表)和 `Map<DOM节点, Map<字段位, edge>>`(边索引),就是 WDPP v1 的核心数据。

---

## 8. 完整 WDPP 工作流程

把上面的所有片段拼起来,完整流程是:

```
1. install() 启动,patch fetch / XHR / DOM

2. fetch('/api/user/42') 响应回来
   ↓
   stampOrigin(response, 'GET /api/user/42')
   ↓
   递归盖戳:
     response.name = 'Alice'
       ↓ smSet(response, 'name', fieldBit)
       ↓ valueIndex.set('Alice', {fieldBit})
       ↓ __wdpp_fields[response].name = fieldBit

3. React 渲染
   h1.textContent = user.name
   ↓
   patchAccessor 拦截 h1.textContent 的 setter
   ↓
   onDomWrite(h1, 'Alice', 'textContent')
   ↓
   查值索引:fieldMap.get('Alice') → {fieldBit: name}
   ↓
   recordEdge(fieldBit, h1, 'data', 'exact')
   ↓
   反向索引也建:h1 → fieldBit
```

如果中间有变换(如 `name.toUpperCase()`):

```
1. 编译后是 __recover(name.toUpperCase(), [name])
2. __recover 把 'name' 的字段位合并到 'NAME' 上
3. DOM 写 'NAME',反查 'NAME' 的字段位,找到 'name' 的字段位
4. 画边:h1 ← name 字段位
```

---

## 9. 为什么按"位图"而不是"路径字符串"存字段?

值索引里,我们存的不是 `"api/user/42.name"` 字符串,而是 **BigInt 位**。

```javascript
let fieldBit = 0;
const fieldRegistry = new Map();  // 路径字符串 → 位号

function getFieldBit(path) {
  if (!fieldRegistry.has(path)) {
    fieldBit++;
    fieldRegistry.set(path, fieldBit);
  }
  return 1n << BigInt(fieldBit);  // 位图
}
```

为什么用位图?

```
如果一个值来自 5 个字段:
  用字符串:Set ['a', 'b', 'c', 'd', 'e'],内存大
  用位图:  0b11111(一个 BigInt),内存小 + 集合运算快
```

位图支持 O(1) 的并集/交集:

```javascript
const fieldsA = 0b1101;  // 字段 0,2,3
const fieldsB = 0b0111;  // 字段 1,2,3
const union = fieldsA | fieldsB;   // 0b1111 = 字段 0,1,2,3
const inter = fieldsA & fieldsB;  // 0b0101 = 字段 0,2
```

这就是 WDPP 用 BigInt 位图的原因。

---

## 10. Babel 插件:把用户代码"插桩"

WDPP 提供一个 Babel 插件,把用户代码改写:

```javascript
// 源码
const x = a + b;
const y = user.name;
const z = isVip && user.role;
obj.status = newStatus;
delete obj.x;

// Babel 编译后
const x = __recover(a + b, [a, b]);
const y = __readField(user, 'name');
const z = __controlAnd(isVip, smGet(isVipContext, ['isVip']), () => user.role);
__writeField(obj, 'status', newStatus);
__deleteField(obj, 'x');
```

**23 个 Babel visitor 覆盖了几乎所有 JS 表达式**——这是 WDPP 的"Universal Taint Union"。

---

## 11. 怎么处理"碰撞"?——分级标签

当一个值在索引里有多个字段,我们不知道是哪一个。

```javascript
stampField('Alice', 'api/user/42.name');        // 字段 1
stampField('Alice', 'api/profile.displayName'); // 字段 2

h1.textContent = 'Alice';
fieldMap.get('Alice');  // {字段 1, 字段 2},count = 2
```

WDPP 给边加 5 档置信度标签:

| 标签 | 含义 |
|---|---|
| `exact` | 唯一来源,精确 |
| `value-match` | 多源但运行时匹配到,UI 让用户选 |
| `approx` | 块级过近似 |
| `collision` | 熔断(>5 字段同值) |
| `none` | 查不到,断流 |

UI 看到 `value-match` 就显示多选下拉:

```javascript
{
  candidates: [
    { field: 'api/user/42.name', confidence: 'value-match' },
    { field: 'api/profile.displayName', confidence: 'value-match' },
  ],
  hint: '值有多个来源,请选择',
}
```

---

## 12. v2 纯图引擎:多源结构自然表达

v1 的"碰撞"是不可避免的——**同一个值就是会撞**。

v2 的思路:**用图来表达多源结构,根本不需要碰撞标签**。

```
图节点:
  - api/user.name   (字段节点)
  - api/character.level (字段节点)
  - expr#render     (表达式节点)
  - dom/span         (DOM 节点)

图边:
  api/user.name      → expr#render
  api/character.level → expr#render
  expr#render        → dom/span
```

查询 `dom/span` 的所有源:

```javascript
function lookup(nodeId, graph) {
  const sources = [];
  const stack = [nodeId];
  const visited = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const node = graph.nodes.get(id);
    if (node?.type === 'api-field') {
      sources.push(node);  // 收集所有源节点
      continue;
    }
    // 反向遍历
    for (const inEdge of graph.incoming.get(id) || []) {
      stack.push(inEdge.from);
    }
  }
  return sources;
}
```

返回结果:

```javascript
[
  { source: api/user.name, path: [io, transform, write] },
  { source: api/character.level, path: [io, transform, write] }
]
```

**多源结构自然表达,无 confidence 标签**。

---

## 13. 边界处理:黑盒怎么办?

Canvas、WebGL、Worker 内部不可观测。

**WDPP 的做法:标输入不标输出**。

```javascript
// Canvas 2D 拦截
const _fillText = CanvasRenderingContext2D.prototype.fillText;
CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
  // 把 text 的 taint 标到 canvas 元素
  const textStamp = fieldMap.get(text);
  if (textStamp) {
    fieldMap.set(this.canvas, textStamp);
  }
  return _fillText.call(this, text, x, y);
};
```

现在 hover canvas 元素,可以看到:

```javascript
{
  candidates: [{ field: 'api/user.name', confidence: 'approx' }],
  hint: 'canvas 黑盒:输入的 taint 已标,绘制内容不可观测'
}
```

**诚实,不假装精确**。

Worker 类似:postMessage 边界是唯一可观测点,在边界传递 taint:

```javascript
// 发送侧
worker.postMessage(data);
// 在 data 上挂 __wdpp_postMessageTaint

// 接收侧
worker.onmessage = (event) => {
  // 取出 taint,挂到 event.data 上
  stampValuePassport(event.data, event.data.__wdpp_postMessageTaint);
};
```

---

## 14. 每种 case 的 hack 清单

### Case 1:fetch 响应是字符串(JSON)

```javascript
// 直接解析后递归盖戳
fetch('/api/x').then(r => r.json()).then(data => {
  stampOrigin(data, 'GET /api/x');
});
```

### Case 2:fetch 响应是 XML

XML 不在主流目标。如果你的项目用 XML,扩展 stampOrigin 解析。

### Case 3:WebSocket 消息是 JSON

```javascript
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  stampOrigin(data, 'ws://host/path');
};
```

### Case 4:WebSocket 消息是二进制

二进制不在主流目标。需要业务方手动加 taint(标记位)。

### Case 5:深拷贝后字段丢失

```javascript
// 深拷贝(克隆)后,WeakMap 全断
const newData = JSON.parse(JSON.stringify(oldData));
newData.name  // 值一样,但对象身份变了
```

**Hack**:白名单识别深拷贝,加 `__passthrough` 递归复制 identity:

```javascript
const _cloneDeep = lodash.cloneDeep;
lodash.cloneDeep = function (src) {
  const r = _cloneDeep(src);
  __passthrough(r, [src]);  // 把 src 的 SM 字段位复制到 r
  return r;
};
```

### Case 6:Promise/await 跨 microtask

```javascript
const x = await fetchData();
```

`__await(x)` 透传值,值带 taint。await 本身不需要特殊处理。

### Case 7:库内部不插桩

```javascript
const formatted = dayjs(date).format('YYYY-MM-DD');
```

dayjs 内部未插桩。**但**:`__recover(formatted, [date])` 已经在调用边界传递了 `date` 的 taint。所以 `formatted` 有 `date` 的字段位。

### Case 8:WASM

WASM 内部完全黑盒。同 Canvas:拦截 JS 边界,把 args taint 标到 caller。

### Case 9:eval / Function

eval 内部代码不经 Babel。运行时 shim:

```javascript
const _eval = globalThis.eval;
globalThis.eval = function (code) {
  const r = _eval.call(this, code);
  __recover(r, [code]);  // 把 code 的 taint 传给 result
  return r;
};
```

### Case 10:跨 origin iframe

浏览器安全策略,无法访问 contentWindow。**这是硬限制,工程上无解**。

### Case 11:解构赋值 `const {a} = obj`

Babel 编译:

```javascript
// 源码
const { a } = obj;
// Babel
const a = __readField(obj, 'a');
```

`a` 继承 `obj.a` 的字段位。

### Case 12:字段突变 `obj.x = y`

```javascript
// 源码
obj.status = 'active';
// Babel
__writeField(obj, 'status', 'active');
```

`obj.status` 后续被读时,`__readProp(obj, 'status')` 拿到新字段位。

### Case 13:删除字段 `delete obj.x`

```javascript
__deleteField(obj, 'x');
```

从 SM 和 `__wdpp_fields` 移除 'x'。

---

## 15. 应用场景

### 场景 1:DevTools 调试

鼠标 hover DOM 节点,显示来源字段。

### 场景 2:API 重构验证

后端把 `user.name` 改成 `user.fullName`,前端的反查会立刻指出哪些地方还在引用旧字段。

### 场景 3:数据治理 / GDPR 合规

```javascript
// "这屏的用户数据来自哪些 API 调用?"
h1.textContent = 'alice@example.com';
lookup(h1);  // → api/user/profile/email
```

### 场景 4:自动化测试

```javascript
// 验证 UI 显示与 API 字段一致
const screen = screen.getByText('Alice');
expect(lookup(screen)).toEqual(['api/user/42.name']);
```

### 场景 5:AI Agent 数据流理解

LLM 想理解前端代码,自动 trace "这个值从哪来"。WDPP 的图结构是天然的语言模型可读格式。

---

## 16. 竞品对比

| 工具 | 拦截方式 | L1 能力 | 边界处理 | 通用性 |
|---|---|---|---|---|
| **Jalangi** | 全插桩(每个赋值/调用) | ❌ 不需要 | N/A | ❌ 26-96× 开销 |
| **React DevTools** | 组件级 | ❌ | ❌ | ❌ 仅 React |
| **Redux DevTools** | Redux state | ❌ | ❌ | ❌ 仅 Redux |
| **Apollo DevTools** | GraphQL cache | ❌ | ❌ | ❌ 仅 Apollo |
| **Chrome DevTools** | 浏览器 API | ❌ | N/A | ❌ 浏览器层 |
| **WDPP** | fetch + DOM + iframe + Worker + Canvas + WebGL | ✅ 3 模式 | ✅ 7+ | ✅ 通用 |

**WDPP 的定位**:跨层集成 + 通用框架无关 + Universal Taint Union。

---

## 17. 自己实现一个迷你版:30 分钟

### 目标

写一个 200 行的 `mini-wdpp.js`,能:
- 拦截 fetch
- 拦截 DOM textContent 写入
- 反查值的字段来源

### 步骤

#### Step 1:值索引(20 行)

```javascript
const fieldMap = new Map();

function stampField(value, path) {
  if (value === null || value === undefined) return;
  if (typeof value === 'object') return;
  // 低熵跳过
  if ([true, false, 0, 1, ''].includes(value)) return;
  // 类型归一化
  const keys = typeof value === 'number' || typeof value === 'boolean'
    ? [value, String(value)] : [value];
  for (const k of keys) {
    if (!fieldMap.has(k)) fieldMap.set(k, new Set());
    fieldMap.get(k).add(path);
  }
}
```

#### Step 2:DOM 拦截(20 行)

```javascript
function patchTextContent() {
  const desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', {
    ...desc,
    set(val) {
      const path = fieldMap.get(val);
      if (path) {
        console.log('DOM 写入:', val, '来自', [...path]);
      }
      desc.set.call(this, val);
    },
  });
}
```

#### Step 3:fetch 拦截(15 行)

```javascript
const _fetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const res = await _fetch.call(this, input, init);
  const clone = res.clone();
  clone.json().then(data => {
    const path = `GET ${typeof input === 'string' ? input : input.url}`;
    function walk(obj, p) {
      if (typeof obj !== 'object' || obj === null) {
        stampField(obj, [...p].join('.'));
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        walk(v, [...p, k]);
      }
    }
    walk(data, [path]);
  }).catch(() => {});
  return res;
};
```

#### Step 4:集成(10 行)

```javascript
patchTextContent();
// 测试
fetch('/api/user/42').then(r => r.json()).then(user => {
  // 假设 user = { name: 'Alice' }
  document.body.textContent = user.name;
  // 控制台:DOM 写入: Alice 来自 GET /api/user/42.name
});
```

### 完整版(200 行)

加上 transform 恢复(40 行)、控制边(30 行)、SM(30 行)、边界处理(35 行),总计 200 行。

---

## 18. 第一性原理:为什么这么做能行?

**核心问题**:屏幕上的值丢失了来源信息。

**核心洞察**:
1. **API → DOM 是单向流**,源头信息只在中途存在。
2. **值在 JS 里是可比的**,可以用 Map 反查。
3. **变换可以用 Babel 拦截**,在调用边界传递 taint。
4. **不可能 100% 精确**,但可以分级标签 + 块级兜底。

**WDPP 的承诺**:
- ✅ 给所有"可观测"的值追溯
- ✅ 给所有"已知"变换传递 taint
- ✅ 给"黑盒"输入标 taint
- ❌ **不假装精确**

---

## 19. 进阶:从按值到按图

v1 用值索引,问题是**多源 = 碰撞**。

v2 用图,每个 api-field 是独立节点,多源结构自然表达:

```
v1 值索引:
  "25" → {field1, field2, field3, field4, field5}  // 5 个字段,无法区分

v2 纯图:
  dom#span ← expr#render ← api/user.level
                        ← api/character.level
                        ← api/product.price
```

**转换算法**:每次盖戳建图节点,每次 DOM 写建图边。查询时反向遍历。

---

## 20. 真实案例:从 0 到能用的 7 天

| 天 | 工作 |
|---|---|
| Day 1 | 实现值索引 + fetch 拦截(50 行) |
| Day 2 | 实现 DOM 拦截(20 行) |
| Day 3 | 实现递归盖戳(50 行) |
| Day 4 | 实现 SM 黑名单(20 行) |
| Day 5 | 实现 Babel 插件 toUpperCase 插桩(80 行) |
| Day 6 | 实现控制边(50 行) |
| Day 7 | 实现 mutation/destructuring 插桩(80 行) |

**总计 ~350 行,7 天**。这就是 WDPP 的最小可用版。

---

## 21. 性能:为什么亚微秒?

```javascript
// 单次 DOM 写入拦截
function onDomWrite(node, value) {
  const path = fieldMap.get(value);  // O(1) Map 查询
  // ...
}
```

`Map.get` 是 O(1) 哈希查找。**亚微秒级别**(~26-195 ns)。

代价:**内存**。每个字段路径占一个 Set entry,每个值占一个 Map entry。50k 字段大约 50MB。

**缓解**:代际压缩(GC 后清理过期)、熔断(超阈值降级采样)。

---

## 22. 总结:WDPP 一句话

> **WDPP 是一个拦截 fetch 和 DOM 的小运行时,把 API 字段到 DOM 值的因果关系记下来,让你在屏幕上看到 "Alice" 时能反查到这是来自 `/api/user/42` 的 `name` 字段。**

实现只用 4 个核心数据结构(Map 值索引、WeakMap SM、控制边数组、边索引)+ 3 个核心拦截(fetch / DOM / 控制边),再加可选的 Babel 插桩。

**复杂度**:**O(1) 查值,O(n) 遍历边,O(n) 内存**。

**可学性**:30 分钟写一个迷你版,7 天写一个生产版。

---

## 23. 你接下来可以做的事

### 入门(1 天)

- ✅ 读本文,理解 WDPP 是什么
- ✅ 抄 200 行迷你版,跑通 `fetch + DOM`
- ✅ 在你现有项目里加 50 行,试试 `fieldMap.get(value)`

### 进阶(1 周)

- ✅ 实现 BigInt 位图替代字符串 Set
- ✅ 加 SM 黑名单
- ✅ 写一个简单的 Babel 插件,只覆盖 BinaryExpression

### 高级(1 月)

- ✅ Universal Taint Union 全部 11 个 helpers
- ✅ 边界处理:Shadow DOM / iframe / Suspense
- ✅ 真实 app 测试:antd / rwa

### 专家(季度)

- ✅ v2 纯图引擎
- ✅ 框架 hook(L1 monkey-patch)
- ✅ 黑盒处理(Canvas / WebGL / Worker)
- ✅ Chrome DevTools Protocol 集成

---

## 24. 推荐资源

| 资源 | 内容 |
|---|---|
| **OpenTelemetry** | 后端 trace 思路借鉴 |
| **React DevTools Profiler** | 组件级 trace 借鉴 |
| **Apollo Client DevTools** | 缓存 trace 借鉴 |
| **W3C PROV-DM** | 数据血缘标准模型 |
| **Jalangi 论文** | 学术污点分析原始思路 |
| **Babel Handbook** | AST 插件编写入门 |

---

## 25. 最后

如果你刚毕业,看完全文还觉得 WDPP 是"魔法",那**回到 Step 17**,抄 200 行迷你版。**抄完你会发现:它不神奇,只是 30 分钟的工作**。

如果你已经能自己写出 WDPP,那意味着你已经超越了"用框架"的阶段,进入了"理解框架"的阶段。

下一步:看你自己的代码,找出"值的来源丢失"的痛点,**自己写一个拦截器**——不需要 24 个 helpers,可能只需要 1 个。

> "Don't fight the framework.Understand it, then improve it."

---

**最后更新**:2026-08-06
**作者**:WDPP 2.0 实现者
**许可**:MIT
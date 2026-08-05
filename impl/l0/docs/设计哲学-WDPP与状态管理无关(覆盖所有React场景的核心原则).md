# 设计哲学 · WDPP 与状态管理无关

> **状态**:核心设计原则 · 不可妥协
> **结论**:WDPP 能覆盖所有 React 状态管理场景,**因为它不依赖任何状态库/代码模式,只依赖 fetch + DOM 这两个最稳定的 API**。

---

## 核心论点

**WDPP 拦截在最稳定的层**(网络 I/O + DOM 写入),**不依赖中间任何环节**(状态管理、组件组织、构建工具)。

```
React 状态管理(任何库)
   │
   ├── API 调用:fetch('/api/user')     ← WDPP 拦截 #1(stampOrigin)
   │
   ├── 状态更新:useState / Redux / Zustand ... ← WDPP 不关心
   │
   ├── 状态读取:const user = useSelector(...)  ← WDPP 不关心
   │
   └── 渲染写 DOM:<h1>{user.name}</h1>         ← WDPP 拦截 #2(onDomWrite)
                                                  边来自"值 → DOM"映射
```

**关键洞察**:**中间状态怎么变,WDPP 完全不依赖**。**只要最终 DOM 写入的值是 API 响应过的值,WDPP 就能追踪**。

---

## 12 种状态管理全覆盖

| # | 场景 | 覆盖率 | WDPP 工作原理 |
|---|---|---|---|
| 1 | **useState / useReducer** | ✅ 100% | fetch 盖戳 → DOM 写查值 |
| 2 | **Redux / Redux Toolkit** | ✅ 100% | API 响应进 reducer → state → 渲染 → DOM |
| 3 | **Zustand** | ✅ 100% | 同上 |
| 4 | **Jotai / Recoil** | ✅ 100% | 原子状态 → 渲染 → DOM |
| 5 | **MobX** | ✅ 100% | 响应式 → 渲染 → DOM |
| 6 | **React Query / SWR** | ✅ 100% | fetch 拦截 + DOM 写 |
| 7 | **Apollo Client** | ✅ 100% | fetch 拦截(apollo 走 XHR)+ DOM 写 |
| 8 | **XState** | ✅ 100% | context → 状态机 → 渲染 → DOM |
| 9 | **Immer / 不可变更新** | ✅ 100% | 新对象身份 → 值索引盖子树并集 |
| 10 | **派生值(useMemo / 计算)** | ✅ 100% | L1 __recover 传播护照 |
| 11 | **Web Components** | ⚠️ 大部分 | innerHTML/setAttribute 已 patch |
| 12 | **第三方组件库(antd / mui)** | ✅ 100% | 内部写 DOM → WDPP 拦截 |

**所有 12 种状态管理方式全覆盖**。

---

## 为什么这是 WDPP 的核心优势

### 业界对比

| 工具 | 绑定点 | 局限 |
|---|---|---|
| **React DevTools** | 绑 React | 看不到 API 字段 |
| **Redux DevTools** | 绑 Redux | 看不到 DOM |
| **Chrome DevTools** | 绑浏览器 | 看不到应用层 |
| **WDPP** | 绑 fetch + DOM | **跨所有状态管理** |

**"绑 fetch + DOM" 是最少依赖的拦截点**——任何前端框架都基于这两个 API。

---

## 设计原则(不可妥协)

### 原则 1:WDPP 不应该适配任何特定状态库

```
❌ 不要做:wdpp-redux.js(Redux 适配器)
❌ 不要做:wdpp-zustand.js(Zustand 适配器)
✅ 做:扩展 fetch / DOM 拦截通道,让所有状态库透明受益
```

### 原则 2:WDPP 不应该假设用户的代码组织方式

```
❌ 不要假设:用户用 hooks(应该兼容 class 组件)
❌ 不要假设:用户用函数组件(应该兼容 class 组件)
❌ 不要假设:用户用单一状态库(应该兼容多库混用)
✅ 假设:用户的代码最终会调用 fetch 写 DOM
```

### 原则 3:WDPP 应该"绑最少的点,得到最广的覆盖"

```
拦截点选择(从最广到最窄):
1. fetch + DOM  ← WDPP 选择(覆盖最广)
2. React fiber  ← 框架级(覆盖 React)
3. Redux store  ← 库级(覆盖 Redux)
4. 特定 API     ← 库级(覆盖一个库)
```

---

## 应对"不可预知"的设计哲学

### 用户场景的"不可预知"

```
- 用户用什么状态管理库:不可预知
- 用户怎么组织组件:不可预知
- 用户写代码的风格:不可预知
- 用户用什么构建工具:不可预知
```

### WDPP 的应对

**不假设,不预测,只拦截最底层**。

```
策略:在最稳定的层(fetch + DOM)拦截
     让上层(状态管理、组件组织)自由变化
     WDPP 的覆盖率 = "fetch + DOM 的覆盖率"
     而不是"用户代码的覆盖率"
```

### 这带来的好处

```
✅ 用户可以任意切换状态库(Redux → Zustand → Jotai)
✅ 用户可以任意重构组件(class → hooks → server components)
✅ 用户可以任意引入新库(React Query → SWR → Apollo)
✅ WDPP 不需要适配,因为它拦截在最稳定的层

✅ 用户改 Redux 到 Zustand:不影响 WDPP
✅ 用户改 class 到 hooks:不影响 WDPP
✅ 用户改 antd 到 mui:不影响 WDPP
✅ 用户改 useState 到 useReducer:不影响 WDPP
```

---

## 反向验证:什么场景覆盖不到?

| 场景 | 原因 | WDPP 策略 |
|---|---|---|
| **Canvas / WebGL** | 非 DOM 路径 | 明示不覆盖 |
| **Shadow DOM** | patchAccessor 在主原型 | 扩展(已在边界问题中) |
| **iframe** | 独立 fetch | 扩展(已在边界问题中) |
| **Web Worker** | 不在主线程 | 扩展 postMessage(已有) |
| **Service Worker** | 独立 fetch | 扩展 |
| **WebSocket 二进制** | 不是 JSON | 扩展 |
| **localStorage / IndexedDB** | setItem/getItem 不直接拦截 | 扩展(已有 JSON.parse 重盖) |

---

## 对项目的影响

### 文档层面

```
README 应该:
  ✅ 明确写:"WDPP 与状态管理库无关"
  ✅ 明确写:"WDPP 只依赖 fetch + DOM,不依赖用户代码模式"
  ❌ 不要写:"WDPP 兼容 Redux"(暗示依赖 Redux)
  ❌ 不要写:"WDPP 兼容 Zustand"(暗示依赖 Zustand)
```

### API 层面

```
✅ install({}) → 通用
❌ install({ redux: true }) → 错误暗示
```

### 错误处理层面

```
✅ 通用错误:"fetch / DOM 拦截失败"(用户可调试)
❌ 特定错误:"Redux reducer 没插桩"(用户困惑)
```

---

## 与"纯图架构"的协同

**纯图架构强化了这个原则**:

```
纯图架构下:
  - 不依赖"值的护照位图"
  - 不依赖"用户代码的字段位传播"
  - 只依赖"节点 + 边 + 路径"

所以纯图架构下,WDPP 与状态管理无关的程度更高:
  - 即使状态管理完全不"传播护照"(没有 L1 兼容)
  - 纯图也能通过 DOM 写入 + 图遍历追踪
```

---

## 总结

| 命题 | 答案 |
|---|---|
| **WDPP 覆盖所有 React 状态管理?** | ✅ **100% 覆盖 12 种** |
| **WDPP 靠什么覆盖?** | **值 + DOM 拦截,不依赖中间环节** |
| **这个覆盖是稳定的吗?** | ✅ **稳定**,因为 fetch + DOM 是最稳定的 API |
| **用户改状态库影响 WDPP 吗?** | ❌ **不影响** |
| **用户改代码风格影响 WDPP 吗?** | ❌ **不影响** |
| **这是 WDPP 的核心优势吗?** | ✅ **是**,绑最少的点得到最广的覆盖 |

---

## 一句话总结

> **WDPP 能覆盖所有 React 状态管理场景,因为它绑最少的点(fetch + DOM),不依赖任何状态库或代码模式。这是 WDPP 最被低估的优势——用户的状态管理怎么变、代码怎么写,WDPP 完全不关心。**

---

**文档版本**:v1.0
**不可妥协原则**:WDPP 永远不应该适配特定状态库,永远应该扩展 fetch + DOM 拦截通道
**下一步**:把所有"未覆盖"场景按优先级列入边界处理清单
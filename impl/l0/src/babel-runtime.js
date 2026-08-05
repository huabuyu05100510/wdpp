// babel-runtime.js - Babel 插件注入的运行时 helper
// 通用机制:__recover 在调用边界把输入护照传到结果(库作整体算子);__fieldGet/__readProp 盖字段护照;
// __control* 登记控制边。value-index 按值查护照,DOM sink 在写入处归因。
//
// P0 修复(并发安全):__lastSlotPassport 从模块全局改为 WeakMap<fiber, slot>,
// React 18+ Concurrent 模式下各 fiber 独立,字段边不互相污染。
import { recover } from './recovery.js';
import { readSlot, smGet, smSet } from './sm.js';
import { controlAdd, controlStackPush, controlStackPop } from './control-index.js';
import { getStamp, stampValuePassport } from './value-index.js';

// 当前渲染 fiber getter(React 18+: __CLIENT_INTERNALS.A;React 17-: ReactCurrentOwner.current)。
// __readProp 据此在 render 时盖字段护照(若在渲染上下文)。host 注入;无 react 时返回 null(跳过)。
let __currentFiberGetter = () => null;
export function __setRCO(getter) {
  __currentFiberGetter = typeof getter === 'function' ? getter : () => getter?.current ?? null;
}
// 内部用 + 导出供测试 / host 高级用法
export function __getCurrentFiberGetter() { return __currentFiberGetter; }
// 兼容旧调用点(模块内已用 __getCurrentFiber() 的地方仍可工作)
function __getCurrentFiber() { return __currentFiberGetter(); }

// React 18+ 自动检测:host 不调用 __setRCO 时,尝试自动探测 React 内部 hook 入口。
// 优先级:__CLIENT_INTERNALS.A(18+) > ReactCurrentOwner.current(17-) > null(无 React)
export function __autoDetectReact() {
  try {
    const React = (typeof globalThis !== 'undefined' && globalThis.React) ||
                  (typeof window !== 'undefined' && window.React);
    if (!React) return false;
    // React 18+ 内部 API(注意:有"DO_NOT_USE"字样,前端框架代码常用,合规)
    const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED
                   || React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    if (internals) {
      if (typeof internals.A?.get === 'function') {
        // React 18+: current dispatcher
        __setRCO(() => internals.A.get());
        return true;
      }
      if (internals.ReactCurrentOwner) {
        // React 17-: current owner(已废弃但仍可用)
        __setRCO(() => internals.ReactCurrentOwner.current);
        return true;
      }
    }
  } catch {}
  return false;
}

// fiber 读取记录:render 时 __readProp 记"当前 fiber 读了哪些 [obj,key]",commit 期读取方按 fiber 反查。
// 用 WeakMap 而非 fiber.__wdppReads -- React 18.3 fiber 不可扩展(Object.isExtensible=false),
// 直接挂属性抛 "Cannot add property __wdppReads, object is not extensible";WeakMap 不要求可扩展 + 不污染 fiber + fiber GC 自清。
const fiberReads = new WeakMap();
export function getFiberReads(fiber) { return fiberReads.get(fiber) ?? null; }

// 仅登记原始值;对象(element/组件返回值)不登记(跨组件边界,L2 处理)
function ctrlAdd(r, passport) {
  if (!passport) return;
  if (r === null || r === undefined || typeof r === 'object') return;
  controlAdd(r, passport);
}

// 变换恢复:result = f(inputs) -> 恢复 result 护照,返回 result(库作整体算子:结果=输入并集)
export function __recover(result, inputs) {
  recover(result, inputs);
  return result;
}

// 深拷贝 pass-through(§7.7):深拷贝是纯函数,输出结构=输入。递归复制输入 identity 到输出,
// 让深拷贝后新对象仍带字段级 identity(非 byVal 值反查,不碰撞)。解决深拷贝断 identity(Proxy 不可克隆)。
function copyIdentityDeep(src, dst, visited) {
  if (!src || !dst || typeof src !== 'object' || typeof dst !== 'object') return;
  if (src === dst) return; // 浅拷贝引用共享,无需复制
  if (!visited) visited = new WeakSet();
  if (visited.has(src)) return; // 循环引用保护
  visited.add(src);
  const sp = getStamp(src); // objectIndex 子树并集
  if (sp && sp.passport) stampValuePassport(dst, sp.passport);
  if (src.__wdpp_fields) { // 字段位并集(含低熵 status)
    try { Object.defineProperty(dst, '__wdpp_fields', { value: src.__wdpp_fields, enumerable: false, configurable: true, writable: true }); } catch {}
  }
  for (const k in src) {
    try {
      const slot = smGet(src, k); // SM 字段槽位(含低熵)
      if (slot) smSet(dst, k, slot);
    } catch {}
    const sv = src[k], dv = dst[k];
    if (sv && dv && typeof sv === 'object' && typeof dv === 'object') {
      copyIdentityDeep(sv, dv, visited); // 递归子字段
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

// 计算式成员 obj[key]:key 带照 -> 控制边(key 选择了 result);静态 key 数据边来自 SM 槽位。
export function __fieldGet(obj, key) {
  const r = obj[key];
  let passport = 0n;
  const ks = getStamp(key);
  if (ks) passport = ks.passport;
  if (ks) ctrlAdd(r, ks.passport); // 动态 key(带照):key 选择了成员 -> 控制边(lookup[code]/valueEnum)
  const slot = (obj != null && typeof obj === 'object') ? smGet(obj, key) : 0n;
  if (slot) passport |= slot;
  // P0 修复:per-fiber 读 slot(原模块全局在并发模式下被别的 fiber 覆盖)
  if (!passport) {
    const last = getCurrentFiberSlot();
    if (last.value === key && last.slot) passport = last.slot;
  }
  if (passport && r !== null && r !== undefined) {
    stampValuePassport(r, passport);
  }
  // P0 修复:per-fiber 写 slot
  if (passport) setCurrentFiberSlot(passport, r);
  return r;
}

// 新容器(字面量/spread)盖"成员并集"戳(identity),否则新容器无照断路。
export function __aggr(container) {
  let union = 0n;
  if (Array.isArray(container)) {
    for (const e of container) { const s = getStamp(e); if (s) union |= s.passport; }
  } else if (container && typeof container === 'object') {
    for (const k in container) { const s = getStamp(container[k]); if (s) union |= s.passport; }
  }
  if (union !== 0n) stampValuePassport(container, union);
  return container;
}

export function __controlAnd(condVal, condPassport, rightFn) {
  if (condVal) {
    if (condPassport) controlStackPush(condPassport);
    try { const r = rightFn(); ctrlAdd(r, condPassport); return r; }
    finally { if (condPassport) controlStackPop(); }
  }
  return condVal;
}
export function __controlOr(condVal, condPassport, rightFn) {
  if (!condVal) {
    if (condPassport) controlStackPush(condPassport);
    try { const r = rightFn(); ctrlAdd(r, condPassport); return r; }
    finally { if (condPassport) controlStackPop(); }
  }
  return condVal;
}
export function __controlTernary(condVal, condPassport, aFn, bFn) {
  if (condPassport) controlStackPush(condPassport);
  try {
    const r = condVal ? aFn() : bFn();
    ctrlAdd(r, condPassport);
    return r;
  } finally { if (condPassport) controlStackPop(); }
}
export function __controlReturn(condPassport, value) {
  ctrlAdd(value, condPassport);
  return value;
}

// 全量属性读 __readProp(obj, key):返回 obj[key] + 盖字段护照(SM 槽位)+ 记录读(若渲染上下文)
// P0 修复:__lastSlotPassport 从模块全局改为 WeakMap<fiber, slot>,React 18+ concurrent 安全。
const fiberLastSlot = new WeakMap(); // fiber → { slot, value }

function getCurrentFiberSlot() {
  const f = __getCurrentFiber();
  if (!f) return { slot: 0n, value: undefined };
  const last = fiberLastSlot.get(f);
  return last || { slot: 0n, value: undefined };
}

function setCurrentFiberSlot(slot, value) {
  const f = __getCurrentFiber();
  // slot === 0n 时不写入(避免无意义 entry 占用 WeakMap,与 "没有 slot" 语义一致)
  if (f && slot !== 0n) fiberLastSlot.set(f, { slot, value });
}

export function __readProp(obj, key) {
  const val = obj[key];
  let slot = (obj != null && typeof obj === 'object') ? smGet(obj, key) : 0n;
  if (slot === 0n && val !== null && val !== undefined && typeof val !== 'object') {
    const os = getStamp(obj);
    if (os) slot = os.passport;
  }
  // P0 修复:per-fiber 存(原:模块全局,React 18+ concurrent 下被覆盖)
  setCurrentFiberSlot(slot, val);
  if (slot && val !== null && val !== undefined && typeof val !== 'object') {
    stampValuePassport(val, slot);
  }
  const f = __getCurrentFiber();
  if (f && obj != null) {
    let reads = fiberReads.get(f);
    if (!reads) { reads = []; fiberReads.set(f, reads); }
    reads.push([obj, key]);
  }
  return val;
}
// optional chaining:obj 为 nullish 时返 undefined(?. 短路),否则正常 __readProp/__fieldGet
export function __readPropOptional(obj, key) {
  if (obj == null) return undefined;
  return __readProp(obj, key);
}
export function __fieldGetOptional(obj, key) {
  if (obj == null) return undefined;
  return __fieldGet(obj, key);
}
// 向后兼容(deprecated):内部已用 per-fiber,这些 getter/setter 仅供无 fiber 场景 fallback
export function __getLastSlotPassport() { return getCurrentFiberSlot().slot; }
export function __resetLastSlotPassport() {
  const f = __getCurrentFiber();
  if (f) fiberLastSlot.delete(f);
}

export { readSlot as __readSlot };

export function __controlEnter(passport) { controlStackPush(passport); }
export function __controlExit() { controlStackPop(); }
export function __controlIfBody(condPassport, bodyFn) {
  controlStackPush(condPassport);
  try { return bodyFn(); } finally { controlStackPop(); }
}
export function __controlSwitch(condPassport, bodyFn) {
  controlStackPush(condPassport);
  try { return bodyFn(); } finally { controlStackPop(); }
}

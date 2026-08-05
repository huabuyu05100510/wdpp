// babel-runtime.js — Universal Taint Helpers
// 所有 helper 内部走 __taint,应用 universal taint union 规则:
//   output = f(inputs) → provenance(output) = ∪ provenance(inputs)

import { getStamp, stampValuePassport, expandBits } from './value-index.js';
import { smGet, smSet, smDelete } from './sm.js';
import { controlAdd, controlStackPush, controlStackPop, getControlStack } from './control-index.js';
import { addNode, addEdge, getCurrentSeq } from './graph.js';

let _opSeq = 0;
function nextOpId(type) {
  return `op:${type}:${++_opSeq}`;
}

// 内部:获取值的 taint(字段护照位图)
function getTaint(v) {
  if (v == null) return 0n;
  const s = getStamp(v);
  return s?.passport || 0n;
}

// 内部:获取对象身份 id(用于图节点)
let _objSeq = 0;
const _objIds = new WeakMap();
function getObjId(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let id = _objIds.get(obj);
  if (!id) { id = `val:obj:${++_objSeq}`; _objIds.set(obj, id); }
  return id;
}

function getValueId(v) {
  if (v == null) return null;
  if (typeof v === 'object') return getObjId(v);
  return `val:prim:${typeof v}:${String(v)}`;
}

/**
 * 核心:universal taint union
 * @param {*} result - 运算结果
 * @param {Array} inputs - 输入数组
 * @param {string} type - 操作类型(callsite 二进制模板用)
 * @param {string} confidence - 置信度
 * @returns result
 */
export function __taint(result, inputs, type = 'op', confidence = 'exact') {
  if (result === null || result === undefined) return result;

  // 收集 inputs 的 taint
  const taints = [];
  for (const inp of inputs) {
    const t = getTaint(inp);
    if (t && t !== 0n) taints.push(t);
  }

  if (taints.length === 0) return result;  // fast-path: 无 taint

  // Union
  const union = taints.reduce((a, b) => a | b, 0n);

  // 1. 应用 union 到 result(value index fast-path)
  stampValuePassport(result, union);

  // 2. 建图:Operation 节点 + produces 边 + derived-from 边
  const opId = nextOpId(type);
  addNode(opId, { type: 'Operation', confidence });
  const resultId = getValueId(result);
  if (resultId) {
    addEdge(opId, resultId, 'produces', confidence);
    for (const t of taints) {
      // 每个 input 的 field id 都作为 derived-from 边
      for (const fid of expandBits(t)) {
        addEdge(resultId, `field:${fid}`, 'derived-from', confidence);
      }
    }
  }

  return result;
}

// ============ 现有 helpers(14 个原 babel plugin 注入)============

/**
 * __recover:函数调用结果 = 输入并集(库作整体算子)
 */
export function __recover(result, inputs) {
  return __taint(result, inputs, 'recover', 'exact');
}

/**
 * __passthrough:深拷贝结果 = 递归复制输入 identity(per-object,不碰撞)
 */
function copyIdentityDeep(src, dst, visited) {
  if (!src || !dst || typeof src !== 'object' || typeof dst !== 'object') return;
  if (src === dst) return;
  if (!visited) visited = new WeakSet();
  if (visited.has(src)) return;
  visited.add(src);

  // 复制子树并集
  const sp = getStamp(src);
  if (sp?.passport) stampValuePassport(dst, sp.passport);

  // 复制字段位
  if (src.__wdpp_fields) {
    try {
      Object.defineProperty(dst, '__wdpp_fields', {
        value: src.__wdpp_fields,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {}
  }

  // 递归子字段
  for (const k in src) {
    try {
      const slot = smGet(src, k);
      if (slot) smSet(dst, k, slot);
    } catch {}
    if (src[k] && dst[k] && typeof src[k] === 'object' && typeof dst[k] === 'object') {
      copyIdentityDeep(src[k], dst[k], visited);
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

/**
 * __aggr:对象/数组字面量(spread) = 成员并集
 */
export function __aggr(container) {
  if (!container || typeof container !== 'object') return container;
  let union = 0n;
  if (Array.isArray(container)) {
    for (const e of container) { const s = getTaint(e); if (s) union |= s; }
  } else {
    for (const k in container) {
      if (k === '__wdpp_fields') continue;
      const s = getTaint(container[k]);
      if (s) union |= s;
    }
  }
  if (union !== 0n) stampValuePassport(container, union);
  return container;
}

/**
 * __readProp:全量属性读 + 字段护照 + 渲染 fiber 记账
 */
const fiberReads = new WeakMap();
let __getCurrentFiber = () => null;
export function __setRCO(getter) {
  __getCurrentFiber = typeof getter === 'function' ? getter : () => getter?.current ?? null;
}

export function getFiberReads(fiber) { return fiberReads.get(fiber) ?? null; }

export function __readProp(obj, key) {
  const val = obj?.[key];
  let slot = (obj != null && typeof obj === 'object') ? smGet(obj, key) : 0n;
  if (slot === 0n && val !== null && val !== undefined && typeof val !== 'object') {
    const os = getStamp(obj);
    if (os) slot = os.passport;
  }
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

export function __readPropOptional(obj, key) {
  if (obj == null) return undefined;
  return __readProp(obj, key);
}

/**
 * __fieldGet:动态 key 读取(计算式成员)
 */
export function __fieldGet(obj, key) {
  const r = obj?.[key];
  let passport = 0n;
  const ks = getStamp(key);
  if (ks) passport = ks.passport;
  if (ks && r !== null && r !== undefined && typeof r !== 'object') {
    controlAdd(r, ks.passport, 'exact');  // 动态 key 选中值 -> 控制边
  }
  const slot = (obj != null && typeof obj === 'object') ? smGet(obj, key) : 0n;
  if (slot) passport |= slot;
  if (passport && r !== null && r !== undefined && typeof r !== 'object') {
    stampValuePassport(r, passport);
  }
  return r;
}

export function __fieldGetOptional(obj, key) {
  if (obj == null) return undefined;
  return __fieldGet(obj, key);
}

/**
 * 控制流 helpers
 */
export function __controlAnd(condVal, condPassport, rightFn) {
  if (condVal) {
    if (condPassport) controlStackPush(condPassport);
    try {
      const r = rightFn();
      if (condPassport && r !== null && r !== undefined && typeof r !== 'object') {
        controlAdd(r, condPassport, 'exact');
      }
      return r;
    } finally {
      if (condPassport) controlStackPop();
    }
  }
  return condVal;
}

export function __controlOr(condVal, condPassport, rightFn) {
  if (!condVal) {
    if (condPassport) controlStackPush(condPassport);
    try {
      const r = rightFn();
      if (condPassport && r !== null && r !== undefined && typeof r !== 'object') {
        controlAdd(r, condPassport, 'exact');
      }
      return r;
    } finally {
      if (condPassport) controlStackPop();
    }
  }
  return condVal;
}

export function __controlTernary(condVal, condPassport, aFn, bFn) {
  if (condPassport) controlStackPush(condPassport);
  try {
    const r = condVal ? aFn() : bFn();
    if (condPassport && r !== null && r !== undefined && typeof r !== 'object') {
      controlAdd(r, condPassport, 'exact');
    }
    return r;
  } finally {
    if (condPassport) controlStackPop();
  }
}

export function __controlEnter(passport) { controlStackPush(passport); }
export function __controlExit() { controlStackPop(); }

// ============ 新增 helpers(7 个,Universal Taint Union 完整覆盖)============

/**
 * __writeField:字段写 obj.x = y — 关键 hack
 * 把 value 的 taint 传给 obj.__wdpp_fields[key]
 */
export function __writeField(obj, key, value) {
  // 原始赋值
  const result = obj[key] = value;

  // 获取 value 的 taint
  const valueTaint = getTaint(value);

  if (valueTaint && obj && typeof obj === 'object') {
    // 更新字段位
    obj.__wdpp_fields = obj.__wdpp_fields || {};
    obj.__wdpp_fields[key] = valueTaint;
    // 更新 SM 槽位
    smSet(obj, key, valueTaint);

    // 建图边
    const opId = nextOpId('write');
    addNode(opId, { type: 'Operation', confidence: 'exact' });
    const fieldNodeId = `field:write:${getObjId(obj)}.${key}`;
    addNode(fieldNodeId, { type: 'Field', confidence: 'exact' });
    addEdge(opId, fieldNodeId, 'produces', 'exact');
    for (const fid of expandBits(valueTaint)) {
      addEdge(fieldNodeId, `field:${fid}`, 'derived-from', 'exact');
    }
  }

  return result;
}

/**
 * __deleteField:字段删 delete obj.x
 */
export function __deleteField(obj, key) {
  if (!obj || typeof obj !== 'object') return;
  // 清字段位 + SM
  if (obj.__wdpp_fields && key in obj.__wdpp_fields) {
    delete obj.__wdpp_fields[key];
  }
  smDelete(obj, key);
  // 原始删除
  return delete obj[key];
}

/**
 * __readSlot:解构 / 计算式读 const {a} = obj
 */
export function __readSlot(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;
  const v = obj[key];
  const slot = smGet(obj, key);
  if (slot && v !== null && v !== undefined && typeof v !== 'object') {
    stampValuePassport(v, slot);
  } else if (slot && v && typeof v === 'object') {
    // 对象:把字段位传给对象
    stampValuePassport(v, slot);
  }
  return v;
}

/**
 * __recoverSelf:变量赋值 x = y(x 是 Identifier)
 */
export function __recoverSelf(x, y) {
  // 引用赋值: x 和 y 共享同一对象/原始值
  // y 的 taint 通过引用传递(无需显式 union)
  return y;
}

/**
 * __throw:throw x(异常传递的 taint)
 */
export function __throw(value) {
  // 异常沿调用栈传递,taint 由 throw site 决定
  const taint = getTaint(value);
  if (taint) {
    // 抛出值的 taint 已被 valueIndex 记录
    // 抛到调用栈的 catch,由 catch 处的变量继承(ReferenceError 边界)
  }
  throw value;
}

/**
 * __await:await x
 */
export async function __await(value) {
  const v = await value;
  // Promise resolve 的值继承 Promise 的 taint
  const taint = getTaint(value);
  if (taint) stampValuePassport(v, taint);
  return v;
}

/**
 * __optionalChain:a?.b(短路 + 字段读)
 */
export function __optionalChain(obj, key) {
  if (obj == null) return undefined;
  return __readSlot(obj, key);
}

/**
 * __nullish:a ?? b
 */
export function __nullish(a, b, aTaint, bTaint) {
  const chosen = a !== null && a !== undefined ? a : b;
  const chosenTaint = a !== null && a !== undefined ? aTaint : bTaint;
  if (chosenTaint) stampValuePassport(chosen, chosenTaint);
  return chosen;
}

/**
 * __taggedTemplate:tag`${x}`(tag 函数收到参数 x)
 */
export function __taggedTemplate(tag, args, strings) {
  const result = tag(...args);
  // tag 函数的 args 都参与,result 继承 args 的 taint
  return __taint(result, args, 'taggedTemplate', 'exact');
}

export function reset() {
  _opSeq = 0;
  fiberReads = new WeakMap();
}

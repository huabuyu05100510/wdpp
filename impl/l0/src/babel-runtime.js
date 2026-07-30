// babel-runtime.js - L1/L2 Babel 插件注入的运行时 helper
import { recover } from './recovery.js';
import { readSlot, smGet } from './sm.js';
import { controlAdd, controlStackPush, controlStackPop } from './control-index.js';

// 仅登记原始值;对象(element/组件返回值)不登记(跨组件边界,L2 处理)
function ctrlAdd(r, passport) {
  if (!passport) return;
  if (r === null || r === undefined || typeof r === 'object') return;
  controlAdd(r, passport);
}

// 变换恢复:result = f(inputs) -> 恢复 result 护照,返回 result
export function __recover(result, inputs) {
  recover(result, inputs);
  return result;
}

// cond && right:cond 真 -> right 受 cond 控制。
// L2:push 控制上下文(同步框架组件渲染时 DOM 写可见控制边);React 延迟渲染栈已空(降级)
export function __controlAnd(condVal, condPassport, rightFn) {
  if (condVal) {
    if (condPassport) controlStackPush(condPassport);
    try { const r = rightFn(); ctrlAdd(r, condPassport); return r; }
    finally { if (condPassport) controlStackPop(); }
  }
  return condVal;
}

// cond || right:cond 假 -> right 受 cond 控制
export function __controlOr(condVal, condPassport, rightFn) {
  if (!condVal) {
    if (condPassport) controlStackPush(condPassport);
    try { const r = rightFn(); ctrlAdd(r, condPassport); return r; }
    finally { if (condPassport) controlStackPop(); }
  }
  return condVal;
}

// cond ? a : b:选中支受 cond 控制
export function __controlTernary(condVal, condPassport, aFn, bFn) {
  if (condPassport) controlStackPush(condPassport);
  try {
    const r = condVal ? aFn() : bFn();
    ctrlAdd(r, condPassport);
    return r;
  } finally { if (condPassport) controlStackPop(); }
}

// if (cond) return X:X 受 cond 控制(原始值登记;element 不登记,跨组件属 L2)
export function __controlReturn(condPassport, value) {
  ctrlAdd(value, condPassport);
  return value;
}

// L2:全量属性读 __readProp(obj, key) -> 返回 obj[key] + 记录 SM 槽位到 thread-local
// 供后续 recover/condition 用更精确的字段级护照
let __lastSlotPassport = 0n;
export function __readProp(obj, key) {
  const val = obj?.[key];
  __lastSlotPassport = (obj != null && typeof obj === 'object') ? smGet(obj, key) : 0n;
  return val;
}
export function __getLastSlotPassport() { return __lastSlotPassport; }
export function __resetLastSlotPassport() { __lastSlotPassport = 0n; }

export { readSlot as __readSlot };

// ===== 控制上下文栈(if 非 return 体 / while / for / switch 用)=====
export function __controlEnter(passport) { controlStackPush(passport); }
export function __controlExit() { controlStackPop(); }

// if (cond) { body } 非return体:enter -> body -> exit
export function __controlIfBody(condPassport, bodyFn) {
  controlStackPush(condPassport);
  try { return bodyFn(); } finally { controlStackPop(); }
}

// switch (expr) { case ... }:判别式控制所有 case 体
export function __controlSwitch(condPassport, bodyFn) {
  controlStackPush(condPassport);
  try { return bodyFn(); } finally { controlStackPop(); }
}

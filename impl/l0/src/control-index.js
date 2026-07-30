// control-index.js - 控制边桥:按值登记"被条件控制的子树会产出的值"-> 条件护照
// 规范:WDPP-L1 §4.3b。L1 求值点(条件栈活)登记;commit 期 onDomWrite 查值时一并查。
// 带代际(同 valueIndex)。注:只闭环内联 JSX;跨组件降级 L2。

import { bumpGeneration } from './value-index.js';

let controlGen = 1;
// value -> [{ passport, conf }] (一个值可能被多个条件控制,列表)
const controlIndex = new Map();

export function controlAdd(value, conditionPassport) {
  if (value === null || value === undefined) return;
  if (conditionPassport === 0n) return;
  const key = (typeof value === 'object') ? String(value) : value;
  let list = controlIndex.get(key);
  if (!list) { list = []; controlIndex.set(key, list); }
  // 去重 + 刷新代际
  for (const e of list) {
    if (e.passport === conditionPassport) { e.gen = controlGen; return; }
  }
  list.push({ passport: conditionPassport, conf: list.length > 0 ? 'approx' : 'value-match', gen: controlGen });
}

export function controlGet(value) {
  if (value === null || value === undefined) return [];
  const key = (typeof value === 'object') ? String(value) : value;
  const list = controlIndex.get(key);
  if (!list) return [];
  return list.filter(e => e.gen === controlGen);
}

export function controlBumpGen() { controlGen++; }

export function controlClear() { controlIndex.clear(); }

// ===== 控制上下文栈(if/while/for 体用)=====
const controlStack = [];
export function controlStackPush(passport) { if (passport) controlStack.push(passport); }
export function controlStackPop() { controlStack.pop(); }
export function getControlStack() { return controlStack; }

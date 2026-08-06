// control-index.js — 控制索引 + 控制栈
// 内联条件表达式({cond && X})的 taint 通过 controlIndex 传递

const _controlIndex = new Map();  // 值 → [{passport, conf}]

export function controlAdd(value, passport, conf = 'exact') {
  if (value === null || value === undefined) return;
  if (typeof value === 'object') return;  // 对象不走 control index
  if (!passport || passport === 0n) return;

  let arr = _controlIndex.get(value);
  if (!arr) { arr = []; _controlIndex.set(value, arr); }
  arr.push({ passport, conf });
}

export function controlGet(value) {
  if (value === null || value === undefined) return [];
  const arr = _controlIndex.get(value);
  return arr ? [...arr] : [];
}

const _controlStack = [];
let _seq = 0;

export function controlStackPush(passport) {
  if (!passport || passport === 0n) return;
  _controlStack.push(passport);
}

export function controlStackPop() {
  _controlStack.pop();
}

export function getControlStack() {
  return [..._controlStack];
}

export function reset() {
  _controlIndex = new Map();
  _controlStack.length = 0;
  _seq = 0;
}

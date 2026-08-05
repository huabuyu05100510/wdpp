// l1-monkeypatch.js - L1 零侵入模式:monkey-patch 原生方法
// 规范:WDPP L1 扩展。在不依赖 Babel 的前提下,通过劫持 String/Number/Array
// 原生方法,实现变换恢复(transform recovery)。
//
// 设计哲学:WDPP 与状态管理无关 — 同样,与代码组织方式也无关。
// 用户可以选 Babel 模式(编译期插桩)或 monkey-patch 模式(运行时劫持)。
// 两种模式互斥,通过 install({l1: 'babel' | 'monkeypatch' | 'off'}) 切换。
//
// 工作原理:
//   String.prototype.toUpperCase 包装版:
//     const _toUpperCase = String.prototype.toUpperCase;
//     String.prototype.toUpperCase = function() {
//       const r = _toUpperCase.call(this);
//       recover(r, [this]);  // L0 recover 给 r 盖 this 的护照
//       return r;
//     };
//
// 限制:
//   - 全局原型修改,被业务方覆盖时失效
//   - 与 polyfill 冲突(core-js 等)
//   - 调试栈多一层

import { recover } from './recovery.js';

// 已 patch 的方法白名单(L1 spec 固化的数学/字符串变换)
const PURE_METHODS = new Set([
  // String
  'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd',
  'slice', 'substring', 'substr', 'split', 'replace', 'replaceAll',
  'padStart', 'padEnd', 'concat', 'repeat', 'normalize',
  // Number
  'toFixed', 'toPrecision', 'toExponential',
  // Array
  'slice', 'splice', 'concat', 'flat', 'flatMap',
  // 注:map/filter/reduce 需要 fn callback,见下方特殊处理
]);

// 需要特殊处理的方法(fn callback)
const CALLBACK_METHODS = new Set(['map', 'filter', 'flatMap', 'reduce', 'reduceRight']);

// 跟踪已 patch 的方法(防重复)
const patchedMethods = new WeakSet();

/**
 * Monkey-patch String.prototype 的方法
 */
function patchStringPrototype() {
  if (!String.prototype) return;
  const proto = String.prototype;

  for (const name of PURE_METHODS) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') continue;
    if (patchedMethods.has(desc.value)) continue;

    const _original = desc.value;
    const wrapped = function () {
      const r = _original.apply(this, arguments);
      // recover: 给结果盖输入的护照
      recover(r, [this]);
      return r;
    };

    Object.defineProperty(proto, name, {
      ...desc,
      value: wrapped,
      writable: true,
      configurable: true,
    });
    patchedMethods.add(wrapped);
  }
}

/**
 * Monkey-patch Number.prototype 的方法
 */
function patchNumberPrototype() {
  if (!Number.prototype) return;
  const proto = Number.prototype;

  for (const name of PURE_METHODS) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') continue;
    if (patchedMethods.has(desc.value)) continue;

    const _original = desc.value;
    const wrapped = function () {
      const r = _original.apply(this, arguments);
      // recover: this 是 number, 不传 (String 化避免精度问题)
      recover(r, [this]);
      return r;
    };

    Object.defineProperty(proto, name, {
      ...desc,
      value: wrapped,
      writable: true,
      configurable: true,
    });
    patchedMethods.add(wrapped);
  }
}

/**
 * Monkey-patch Array.prototype 的方法
 */
function patchArrayPrototype() {
  if (!Array.prototype) return;
  const proto = Array.prototype;

  // 普通方法(pure)
  for (const name of PURE_METHODS) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') continue;
    if (patchedMethods.has(desc.value)) continue;

    const _original = desc.value;
    const wrapped = function () {
      const r = _original.apply(this, arguments);
      // Array 返回数组,recover 会处理对象身份盖戳
      recover(r, [this]);
      return r;
    };

    Object.defineProperty(proto, name, {
      ...desc,
      value: wrapped,
      writable: true,
      configurable: true,
    });
    patchedMethods.add(wrapped);
  }

  // callback 方法(map/filter/flatMap)
  for (const name of CALLBACK_METHODS) {
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') continue;
    if (patchedMethods.has(desc.value)) continue;

    const _original = desc.value;
    const wrapped = function (fn, thisArg) {
      const r = _original.call(this, fn, thisArg);
      recover(r, [this]);
      return r;
    };

    Object.defineProperty(proto, name, {
      ...desc,
      value: wrapped,
      writable: true,
      configurable: true,
    });
    patchedMethods.add(wrapped);
  }
}

/**
 * Monkey-patch Object.prototype 的方法
 */
function patchObjectPrototype() {
  if (!Object.prototype) return;
  const proto = Object.prototype;

  // Object.assign(target, ...sources) -> target 携带 sources 的并集
  const desc = Object.getOwnPropertyDescriptor(proto, 'assign');
  if (desc && typeof desc.value === 'function' && !patchedMethods.has(desc.value)) {
    const _assign = desc.value;
    const wrapped = function (target, ...sources) {
      const r = _assign.call(this, target, ...sources);
      // Object.assign 后,target 携带 sources 的护照并集
      for (const src of sources) {
        if (src && typeof src === 'object') {
          recover(r, [src]);
        }
      }
      return r;
    };
    Object.defineProperty(proto, 'assign', {
      ...desc,
      value: wrapped,
      writable: true,
      configurable: true,
    });
    patchedMethods.add(wrapped);
  }
}

let started = false;

/**
 * 启动 monkey-patch 模式 L1
 * 注意:会被业务方的 polyfill 覆盖;但能覆盖业务方的代码
 */
export function startL1Monkeypatch() {
  if (started) return;
  started = true;

  if (typeof globalThis === 'undefined') return;

  try {
    patchStringPrototype();
    patchNumberPrototype();
    patchArrayPrototype();
    patchObjectPrototype();
  } catch (e) {
    // 某些环境下原型不可扩展,静默失败
  }
}

/**
 * 检查 monkey-patch 是否启用
 */
export function isL1MonkeypatchActive() {
  return started;
}
// p0-fixes-r2.js - P0 修复回归测试
// 验证 3 个 P0 修复:
//   1. stampValue(undefined, fieldId) 不再让 undefined 进值索引(批量假阳性修复)
//   2. per-fiber slot 隔离(React 18+ concurrent 安全)
//   3. __autoDetectReact() 正确检测 React 18+ / 17- / 无 React
//
// 运行:node --test test/p0-fixes-r2.conformance.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampOrigin } from '../src/stamp-origin.js';
import {
  stampValue, getStamp, getFieldId, bumpGeneration, valueIndexSize,
  stampValuePassport
} from '../src/value-index.js';

// ============================================================
// P0 修复 1: stampValue(undefined) 不进值索引
// ============================================================
// 旧实现:stampValue(undefined, fieldId) 会调用 valueIndex.set(undefined, ...)
//         所有后续 getStamp(undefined) 都会命中该位 → 批量假阳性
// 新实现:stampValue 入口 guard,undefined 直接 return
test('P0 修复 1:stampValue(undefined, ...) 不进值索引', () => {
  const idxBefore = valueIndexSize();
  // 模拟 stamp-origin.js:218:数组子树并集 0n 时调用
  stampValue(undefined, getFieldId('GET /test/items[]'));
  // 应该直接 return,值索引不变
  assert.equal(valueIndexSize(), idxBefore, 'undefined 不应进值索引');
  // 查询 undefined 也应返回 null
  assert.equal(getStamp(undefined), null, 'getStamp(undefined) 应返回 null');
});

test('P0 修复 1:数组全低熵叶子 -> 子树并集 0n -> 不污染 undefined', () => {
  bumpGeneration(); // 隔离测试
  // 数组元素全是低熵:flag: true, count: 0, name: ''
  // 子树并集 sub = 0n(低熵不入 SM)
  // 旧代码:stampValue(undefined, fieldId) → 污染 undefined
  // 新代码:stampValue 入口 guard
  const data = { items: [{ flag: true, count: 0, name: '' }] };
  stampOrigin(data, 'GET /arr-low-entropy');

  // valueIndex 应该没有 undefined key
  assert.equal(getStamp(undefined), null,
    '全低熵数组不应让 undefined 进值索引');

  // 但实际有效值(若有)仍应能查到
  // 这里 items[].flag 全是 true(低熵),不该盖戳,符合预期
});

test('P0 修复 1:null 同样不应进值索引', () => {
  stampValue(null, getFieldId('GET /test/null'));
  assert.equal(getStamp(null), null, 'null 不应进值索引(null 本来就黑名单)');
});

test('P0 修复 1:stampValuePassport(null) 已有 guard,保持不变', () => {
  // stampValuePassport 之前已经有 null/undefined guard
  // 验证没被本次修改影响
  assert.doesNotThrow(() => stampValuePassport(null, 1n));
  assert.doesNotThrow(() => stampValuePassport(undefined, 1n));
});

// ============================================================
// P0 修复 2: per-fiber slot 隔离(并发安全)
// ============================================================
// 旧实现:__lastSlotPassport 是模块全局,React 18+ concurrent 模式下被别的 fiber 覆盖
// 新实现:WeakMap<fiber, slot>,每个 fiber 独立

test('P0 修复 2:per-fiber slot 隔离 -- 不同 fiber 互不污染', async () => {
  const { __readProp, __fieldGet, __setRCO, __getLastSlotPassport } =
    await import('../src/babel-runtime.js');
  const { getFieldId, stampValuePassport, smSet } = await import('../src/value-index.js');
  const { smSet: realSmSet } = await import('../src/sm.js');

  // 创建两个 fiber 对象(模拟)
  const fiberA = { type: 'A', id: 'fiber-A' };
  const fiberB = { type: 'B', id: 'fiber-B' };

  // 模拟 host 设置:用 fiber getter
  let currentFiber = null;
  __setRCO(() => currentFiber);

  // 创建两个数据对象,字段位不同
  const dataA = { name: 'Alpha' };
  const dataB = { name: 'Beta' };
  const slotA = getFieldId('GET /sourceA.name');
  const slotB = getFieldId('GET /sourceB.name');

  // 把字段位盖到对象 SM 上
  realSmSet(dataA, 'name', BigInt(1) << BigInt(slotA));
  realSmSet(dataB, 'name', BigInt(1) << BigInt(slotB));

  // Fiber A 上下文:读 dataA.name
  currentFiber = fiberA;
  __readProp(dataA, 'name');
  // Fiber A 的 slot 应该是 slotA
  assert.equal(__getLastSlotPassport(), BigInt(1) << BigInt(slotA),
    'fiberA 的 slot 应是 dataA.name 的位');

  // 切换到 Fiber B 上下文:读 dataB.name(模拟并发模式下别的 fiber 渲染)
  currentFiber = fiberB;
  __readProp(dataB, 'name');
  // Fiber B 的 slot 应该是 slotB(不被 fiberA 覆盖)
  assert.equal(__getLastSlotPassport(), BigInt(1) << BigInt(slotB),
    'fiberB 的 slot 应是 dataB.name 的位(fiberA 的不能污染)');

  // 切回 Fiber A:slot 应该恢复为 slotA
  currentFiber = fiberA;
  assert.equal(__getLastSlotPassport(), BigInt(1) << BigInt(slotA),
    '切回 fiberA 后 slot 应恢复(per-fiber 隔离)');
});

test('P0 修复 2:__resetLastSlotPassport 只清当前 fiber', async () => {
  const { __readProp, __setRCO, __getLastSlotPassport, __resetLastSlotPassport } =
    await import('../src/babel-runtime.js');
  const { smSet } = await import('../src/sm.js');

  const fiberA = { id: 'reset-test-A' };
  const fiberB = { id: 'reset-test-B' };
  let currentFiber = null;
  __setRCO(() => currentFiber);

  // 用有 SM 槽位的对象(否则 slot=0n,setCurrentFiberSlot 不写入)
  const objA = {};
  const objB = {};
  smSet(objA, 'name', 1n << 5n);  // 给 A 一个非 0 slot
  smSet(objB, 'name', 1n << 7n);  // 给 B 一个不同的非 0 slot

  // 给两个 fiber 都设 slot
  currentFiber = fiberA;
  __readProp(objA, 'name');
  const slotA = __getLastSlotPassport();
  assert.equal(slotA, 1n << 5n, 'fiberA 应有非 0 slot');

  currentFiber = fiberB;
  __readProp(objB, 'name');
  const slotB = __getLastSlotPassport();
  assert.equal(slotB, 1n << 7n, 'fiberB 应有非 0 slot');

  // 重置 fiberB
  currentFiber = fiberB;
  __resetLastSlotPassport();

  // 切到 fiberA,slot 应该还在(没被 fiberB 的 reset 影响)
  currentFiber = fiberA;
  assert.equal(__getLastSlotPassport(), slotA,
    'reset fiberB 不应影响 fiberA 的 slot');

  // 切到 fiberB,slot 应被清空
  currentFiber = fiberB;
  assert.equal(__getLastSlotPassport(), 0n,
    'fiberB 的 slot 应被 reset 清空');
});

test('P0 修复 2:无 fiber 上下文时(getCurrentFiber 返回 null)优雅降级', async () => {
  const { __readProp, __setRCO, __getLastSlotPassport } =
    await import('../src/babel-runtime.js');

  // 不调 __setRCO,默认 getter 返回 null
  // 应该不抛错
  assert.doesNotThrow(() => __readProp({}, 'name'));
  assert.equal(__getLastSlotPassport(), 0n, '无 fiber 时 slot 应为 0n');
});

// ============================================================
// P0 修复 3: __autoDetectReact() 版本检测
// ============================================================

test('P0 修复 3:__autoDetectReact() 在无 React 时返回 false', async () => {
  const { __autoDetectReact } = await import('../src/babel-runtime.js');
  // jsdom 没有 React,应该返回 false
  // 全局 React 不存在
  const before = globalThis.React;
  delete globalThis.React;
  try {
    const detected = __autoDetectReact();
    assert.equal(detected, false, '无 React 时应返回 false');
  } finally {
    if (before) globalThis.React = before;
  }
});

test('P0 修复 3:__autoDetectReact() 检测 React 18+ __CLIENT_INTERNALS', async () => {
  const { __autoDetectReact, __setRCO, __getCurrentFiberGetter } =
    await import('../src/babel-runtime.js');

  const before = globalThis.React;
  // 模拟 React 18+ 内部结构
  globalThis.React = {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      A: { get: () => ({ mockFiber: 'react-18-fiber' }) }
    }
  };
  try {
    const detected = __autoDetectReact();
    assert.equal(detected, true, 'React 18+ 应被检测');
    // 验证 getter 已设置
    const getter = __getCurrentFiberGetter();
    assert.equal(typeof getter, 'function', '应返回 getter 函数');
    const f = getter();
    assert.deepEqual(f, { mockFiber: 'react-18-fiber' });
  } finally {
    if (before) globalThis.React = before;
    else delete globalThis.React;
    // 还原
    __setRCO(() => null);
  }
});

test('P0 修复 3:__autoDetectReact() 检测 React 17- ReactCurrentOwner', async () => {
  const { __autoDetectReact, __setRCO, __getCurrentFiberGetter } =
    await import('../src/babel-runtime.js');

  const before = globalThis.React;
  // 模拟 React 17- 内部结构
  globalThis.React = {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentOwner: { current: { mockFiber: 'react-17-fiber' } }
    }
  };
  try {
    const detected = __autoDetectReact();
    assert.equal(detected, true, 'React 17- 应被检测');
    const getter = __getCurrentFiberGetter();
    const f = getter();
    assert.deepEqual(f, { mockFiber: 'react-17-fiber' });
  } finally {
    if (before) globalThis.React = before;
    else delete globalThis.React;
    __setRCO(() => null);
  }
});

// ============================================================
// 集成测试: install() 时自动调用 __autoDetectReact()
// 注:不调 install()(它会触发 dom-sink.js 需要 jsdom),
// 改为直接验证 __setRCO / __autoDetectReact 的集成行为
// ============================================================

test('P0 集成:__autoDetectReact + __setRCO 集成工作流', async () => {
  const { __autoDetectReact, __setRCO, __getCurrentFiberGetter } =
    await import('../src/babel-runtime.js');

  const beforeReact = globalThis.React;
  globalThis.React = {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      A: { get: () => ({ installedFiber: 'install-test' }) }
    }
  };
  try {
    // 模拟 install() 的内部行为(不调 install 避免触发 dom-sink)
    const detected = __autoDetectReact();
    assert.equal(detected, true);
    // 验证 getter 已设
    const f = __getCurrentFiberGetter()();
    assert.deepEqual(f, { installedFiber: 'install-test' });
  } finally {
    if (beforeReact) globalThis.React = beforeReact;
    else delete globalThis.React;
    __setRCO(() => null);
  }
});

test('P0 集成:host 显式 __setRCO 覆盖自动检测', async () => {
  const { __autoDetectReact, __setRCO, __getCurrentFiberGetter } =
    await import('../src/babel-runtime.js');

  const beforeReact = globalThis.React;
  globalThis.React = {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      A: { get: () => ({ autoDetected: true }) }
    }
  };
  try {
    __autoDetectReact();
    // host 显式覆盖
    __setRCO(() => ({ manualOverride: true }));
    const f = __getCurrentFiberGetter()();
    assert.deepEqual(f, { manualOverride: true },
      'host 显式 __setRCO 应覆盖自动检测');
  } finally {
    if (beforeReact) globalThis.React = beforeReact;
    else delete globalThis.React;
    __setRCO(() => null);
  }
});
// value-index.js — 值索引(fast-path,非 source of truth)
// 给定一个原始值,反查它的字段护照(位图)
// 图是 source of truth,值索引是 fast-path 加速

import { getNode, getAncestorApis } from './graph.js';

let _fieldRegistry = new Map();  // path(string) → fieldId(number)
let _fieldPaths = new Map();     // fieldId(number) → path(string)
let _nextFieldId = 1;
let _currentGen = 1;

// 字段位操作
export function getFieldId(path) {
  let id = _fieldRegistry.get(path);
  if (id === undefined) {
    id = _nextFieldId++;
    _fieldRegistry.set(path, id);
    _fieldPaths.set(id, path);
  }
  return id;
}

export function bit(id) { return 1n << BigInt(id); }

export function fieldIdToPath(id) {
  return _fieldPaths.get(id) || null;
}

export function fieldCount() { return _nextFieldId - 1; }

export function bumpGeneration() {
  _currentGen++;
  // 简化:不立即压缩,等 compaction
}

// 值索引(原始值 → passport 位图)
const _valueIndex = new Map();
const _objectIndex = new WeakMap();  // 对象 → { passport, gen }

const LOW_ENTROPY = new Set([true, false, 0, 1, '', '0', '1', 'true', 'false', null, undefined]);

function isLowEntropy(v) {
  if (v === null || v === undefined) return true;
  if (LOW_ENTROPY.has(v)) return true;
  return false;
}

function keysFor(v) {
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return [v, String(v)];
  }
  return [v];
}

/**
 * 盖戳:把字段 id 并入值的护照
 */
export function stampValue(v, fieldId) {
  if (isLowEntropy(v)) return;
  if (typeof v === 'object') return;
  for (const key of keysFor(v)) {
    const entry = _valueIndex.get(key);
    if (entry) {
      entry.passport |= bit(fieldId);
      entry.gen = _currentGen;
    } else {
      _valueIndex.set(key, { passport: bit(fieldId), gen: _currentGen });
    }
  }
}

/**
 * 查询:返回 { passport, collision, count } 或 null
 */
export function getStamp(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    const e = _objectIndex.get(v);
    if (!e || e.gen !== _currentGen || e.passport === 0n) return null;
    const count = popcount(e.passport);
    return { passport: e.passport, collision: count > 5, count };
  }
  let passport = 0n;
  let hit = false;
  for (const key of keysFor(v)) {
    const entry = _valueIndex.get(key);
    if (entry && entry.gen === _currentGen) {
      passport |= entry.passport;
      hit = true;
    }
  }
  if (!hit || passport === 0n) return null;
  const count = popcount(passport);
  return { passport, collision: count > 5, count };
}

function popcount(b) {
  let n = 0;
  while (b) { n += Number(b & 1n); b >>= 1n; }
  return n;
}

/**
 * 直接盖护照(变换恢复用:result = inputs union)
 */
export function stampValuePassport(v, passport) {
  if (v === null || v === undefined) return;
  if (passport === 0n) return;
  if (typeof v === 'object') {
    const e = _objectIndex.get(v);
    _objectIndex.set(v, {
      passport: (e?.passport || 0n) | passport,
      gen: _currentGen,
    });
    return;
  }
  if (isLowEntropy(v)) return;
  for (const key of keysFor(v)) {
    const entry = _valueIndex.get(key);
    if (entry) { entry.passport |= passport; entry.gen = _currentGen; }
    else { _valueIndex.set(key, { passport, gen: _currentGen }); }
  }
}

/**
 * 展开位图为 fieldId 数组
 */
export function expandBits(b) {
  const ids = [];
  let id = 0;
  while (b) {
    if (b & 1n) ids.push(id);
    b >>= 1n;
    id++;
  }
  return ids;
}

const COMPACT_THRESHOLD = 50000;

export function compact() {
  let removed = 0;
  for (const [k, entry] of _valueIndex) {
    if (entry.gen !== _currentGen) { _valueIndex.delete(k); removed++; }
  }
  return removed;
}

function maybeCompact() {
  if (_valueIndex.size > COMPACT_THRESHOLD) compact();
}

export function valueIndexSize() { return _valueIndex.size; }

export function reset() {
  _fieldRegistry = new Map();
  _fieldPaths = new Map();
  _nextFieldId = 1;
  _currentGen = 1;
  // Map 不能 reset,新建
  for (const k of _valueIndex.keys()) _valueIndex.delete(k);
}

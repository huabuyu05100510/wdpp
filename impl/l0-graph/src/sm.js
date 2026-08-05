// sm.js — Slot Map: per-object per-field 护照位图
// 用于解构、字段读取等场景的字段护照追踪

const _slots = new WeakMap();  // obj → Map<key, bigint>

export function smSet(obj, key, passport) {
  if (!obj || typeof obj !== 'object') return;
  let m = _slots.get(obj);
  if (!m) { m = new Map(); _slots.set(obj, m); }
  m.set(key, passport);
}

export function smGet(obj, key) {
  if (!obj || typeof obj !== 'object') return 0n;
  const m = _slots.get(obj);
  return m?.get(key) || 0n;
}

export function smDelete(obj, key) {
  if (!obj || typeof obj !== 'object') return;
  const m = _slots.get(obj);
  if (m) m.delete(key);
}

export function smHas(obj, key) {
  if (!obj || typeof obj !== 'object') return false;
  return _slots.get(obj)?.has(key) || false;
}

export function reset() {
  // WeakMap 不能 reset,等待 GC
}

// labeled-box.js — Taint 追踪:用 WeakMap 而非包装对象
// 这样 React 看到原始值不会报错,taint 单独存

// 值 → API 列表(primitive 值)
const _valueTaint = new WeakMap();

// 设置值的 taint
export function setTaint(value, api) {
  if (value === null || value === undefined) return;
  if (typeof value === 'object') {
    // 对象:设置 __wdpp_api 属性(后续读取也带)
    value.__wdpp_api = api;
    return;
  }
  // primitive:存 WeakMap
  const existing = _valueTaint.get(value) || [];
  if (!existing.includes(api)) {
    _valueTaint.set(value, [...existing, api]);
  }
}

// 取值的 taint
export function getTaint(value) {
  if (value === null || value === undefined) return [];
  if (typeof value === 'object') {
    if (value.__wdpp_api) return [value.__wdpp_api];
    return [];
  }
  return _valueTaint.get(value) || [];
}

// 检查值是否带 taint
export function hasTaint(value) {
  return getTaint(value).length > 0;
}

// Union taints(从多个 inputs 合并)
export function unionTaints(inputs) {
  const apis = new Set();
  for (const inp of inputs) {
    for (const a of getTaint(inp)) apis.add(a);
  }
  return [...apis];
}

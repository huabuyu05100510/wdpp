// value-index.js — 值映射 + 字段 ID + 低熵黑名单 + 熔断 + 代际
// 规范:WDPP-L0 §3.7/§4.7。一个 Map<原始值, {passport, gen}>,按值查护照。

/** @typedef {bigint} Passport */ // 字段位图,第 i 位 = 字段 i 在集合中

const fieldRegistry = new Map(); // path(string) -> fieldId(number)
let nextFieldId = 1;

/** 值索引:原始值 -> { passport, gen }。对象按 identity 走 objectIndex(过近似用)。 */
const valueIndex = new Map();
const objectIndex = new WeakMap(); // 对象 -> { passport, gen }(receiver 过近似:不透明调用拿对象当输入)

let currentGen = 1;

// 低熵值黑名单:true/false/0/1/""/null/undefined 不盖戳、不查询
const LOW_ENTROPY = new Set([true, false, 0, 1, '', '0', '1', 'true', 'false', null, undefined]);
// 可配置词表(状态码、枚举文案)—— demo 用空集,生产可加 '200','success','active',...
const LOW_ENTROPY_EXTRA = new Set();

const BREAKER_K = 5; // 护照集熔断阈值

export function getFieldId(path) {
  let id = fieldRegistry.get(path);
  if (id === undefined) { id = nextFieldId++; fieldRegistry.set(path, id); }
  return id;
}

export function bit(id) { return 1n << BigInt(id); }

function isLowEntropy(v) {
  if (v === null || v === undefined) return true;
  if (LOW_ENTROPY.has(v)) return true;
  // 数字 0/1 已在;小整数也低熵?只禁 0/1,其他数字(7/42)允许但会碰撞
  if (typeof v === 'string' && LOW_ENTROPY_EXTRA.has(v)) return true;
  return false;
}

// 类型归一化:数字/布尔同时存原始值和 String(v),因 DOM 侧永远写字符串
function keysFor(v) {
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return [v, String(v)];
  }
  return [v];
}

// 盖戳:把字段 id 并入值的护照
export function stampValue(v, fieldId) {
  if (isLowEntropy(v)) return;
  if (typeof v === 'object') return; // 对象不入值索引(L0)
  for (const key of keysFor(v)) {
    const entry = valueIndex.get(key);
    if (entry) {
      entry.passport |= bit(fieldId);
      entry.gen = currentGen; // 刷新代际(重新见过)
    } else {
      valueIndex.set(key, { passport: bit(fieldId), gen: currentGen });
    }
  }
  maybeCompact(); // 超阈值自动压缩(物理删过期代)
}

// 查询:返回 { passport, collision } 或 null。过滤过期代。
export function getStamp(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') { // 对象按 identity 查(receiver 过近似)
    const e = objectIndex.get(v);
    if (!e || e.gen !== currentGen || e.passport === 0n) return null;
    const count = popcount(e.passport);
    return { passport: e.passport, collision: count > BREAKER_K, count };
  }
  let passport = 0n;
  let hit = false;
  for (const key of keysFor(v)) {
    const entry = valueIndex.get(key);
    if (entry && entry.gen === currentGen) { passport |= entry.passport; hit = true; }
  }
  if (!hit || passport === 0n) return null;
  const count = popcount(passport);
  if (count > BREAKER_K) return { passport, collision: true, count };
  return { passport, collision: false, count };
}

function popcount(b) {
  let n = 0; while (b) { n += Number(b & 1n); b >>= 1n; } return n;
}

export function expandBits(b) {
  const ids = []; let id = 0;
  while (b) { if (b & 1n) ids.push(id); b >>= 1n; id++; }
  return ids;
}

// 直接给一个值盖上"护照集合"(变换恢复用:结果值 = 输入并集)
export function stampValuePassport(v, passport, conf) {
  if (v === null || v === undefined) return;
  if (passport === 0n) return;
  if (typeof v === 'object') { // 对象:按 identity 盖(子树并集),供 receiver 过近似
    const e = objectIndex.get(v);
    objectIndex.set(v, { passport: (e?.passport || 0n) | passport, gen: currentGen });
    return;
  }
  if (isLowEntropy(v)) return;
  for (const key of keysFor(v)) {
    const entry = valueIndex.get(key);
    if (entry) { entry.passport |= passport; entry.gen = currentGen; }
    else { valueIndex.set(key, { passport, gen: currentGen }); }
  }
}

const COMPACT_THRESHOLD = 50000; // 值索引条目超此阈值触发压缩

// 压缩:物理删除过期代(gen !== currentGen)的条目。
// 长 session 内存只增不降的根因是代际只过滤查询不删条目;此函数做物理回收。
export function compact() {
  let removed = 0;
  for (const [k, entry] of valueIndex) {
    if (entry.gen !== currentGen) { valueIndex.delete(k); removed++; }
  }
  return removed;
}

// 条目数(测试/bench 用)
export function valueIndexSize() { return valueIndex.size; }

// 自动压缩:超阈值且有过期代时触发。在 stampValue 内调用。
function maybeCompact() {
  if (valueIndex.size > COMPACT_THRESHOLD) compact();
}

export function bumpGeneration() {
  currentGen++;
  compact(); // 切代际时压缩(旧 session 条目物理删除)
}
export function getCurrentGen() { return currentGen; }
export function fieldIdToPath(id) {
  for (const [p, i] of fieldRegistry) if (i === id) return p;
  return null;
}
export function fieldCount() { return nextFieldId - 1; }

// entityKey(记录级血缘):值 -> id 字段值或数组 index
const entityKeyMap = new Map();
export function setEntityKey(value, key) {
  if (value !== null && value !== undefined && typeof value !== 'object') entityKeyMap.set(value, key);
}
export function getEntityKey(value) { return entityKeyMap.get(value) ?? null; }

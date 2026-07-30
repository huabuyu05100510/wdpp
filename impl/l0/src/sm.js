// sm.js - Shadow Memory(条件槽位侧车用):WeakMap<object, {fields: Map<key, passport>}>
// 规范:WDPP-L1 §4.3b。条件表达式要读字段级护照(SM(obj).fields.get('isVip')),
// 不是查值 passport(true)(布尔低熵会噪声)。盖戳时双写 SM。

const SM = new WeakMap();

export function ensureShadow(obj) {
  let sh = SM.get(obj);
  if (!sh) { sh = { fields: new Map() }; SM.set(obj, sh); }
  return sh;
}

export function smGet(obj, key) {
  const sh = SM.get(obj);
  if (!sh) return 0n;
  return sh.fields.get(key) ?? 0n;
}

export function smSet(obj, key, passport) {
  if (passport === 0n) return;
  ensureShadow(obj).fields.set(key, smGet(obj, key) | passport);
}

// 从对象 + 链式属性路径读字段级护照:readSlot(data, ['user','isVip'])
// 用于条件表达式:`if (data.user.isVip)` -> readSlot(data, ['user','isVip'])
export function readSlot(root, path) {
  let obj = root;
  for (let i = 0; i < path.length - 1; i++) {
    if (obj == null) return 0n;
    obj = obj[path[i]];
  }
  if (obj == null) return 0n;
  return smGet(obj, path[path.length - 1]);
}

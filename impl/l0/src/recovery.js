// recovery.js - 不透明函数四档恢复(变换插桩用)
// 规范:WDPP §3.5。调用点 `f(a,b) -> result` 后,恢复 result 护照:
//   ① 身份匹配(result===arg)-> 精确继承
//   ② 值指纹(result 已在值索引)-> 保持(查询侧自然命中,无需操作)
//   ③ 并集兜底(输入有护照但 result 不在索引)-> result = ∪输入护照,标 approx
//   ④ CUT(输入无护照)

import { getStamp, stampValuePassport } from './value-index.js';

// 纯方法/函数调用后调用:recover(result, [recv, ...args])
export function recover(result, inputs) {
  if (result === null || result === undefined) return;
  if (typeof result === 'object') {
    // 对象结果(工厂/map-filter/构造返回的新容器):盖"输入并集"戳(identity),
    // 否则新容器无照 → 作 receiver 过近似时断路。
    let union = 0n;
    for (const inp of inputs) { const s = getStamp(inp); if (s) union |= s.passport; }
    if (union !== 0n) stampValuePassport(result, union);
    return;
  }

  // ① 身份匹配:result === 某输入 -> 精确继承
  for (const inp of inputs) {
    if (inp === result) {
      const s = getStamp(inp);
      if (s) stampValuePassport(result, s.passport);
      return;
    }
  }

  // ② 值指纹:result 已在索引 -> 查询侧自然命中,不动(避免并集污染精确命中)
  if (getStamp(result)) return;

  // ③ 并集兜底:result 不在索引,输入有护照 -> result = ∪输入护照,标 approx
  let union = 0n;
  for (const inp of inputs) {
    const s = getStamp(inp);
    if (s) union |= s.passport;
  }
  if (union !== 0n) stampValuePassport(result, union); // 标 approx(查询时 count>1 即 collision)
  // ④ 输入无护照 -> 不动(CUT)
}

// 纯方法白名单(spec 固定的变换类方法,result$ = recv$ ∪ args$)
const PURE_METHODS = new Set([
  'toUpperCase', 'toLowerCase', 'trim', 'trimStart', 'trimEnd',
  'slice', 'substring', 'substr', 'split', 'replace', 'replaceAll',
  'padStart', 'padEnd', 'concat', 'at', 'charAt', 'charCodeAt', 'repeat', 'normalize',
  'toFixed', 'toPrecision', 'toExponential', 'toString',
  'join', 'indexOf', 'lastIndexOf', 'includes', 'startsWith', 'endsWith',
]);

export function isPureMethod(name) { return PURE_METHODS.has(name); }

// component-bind.js - 通用组件级归因(块级 + 字段级 fiberReads),不 by case。
// 块级(bindComponentData):组件 props 含带 API identity 的对象 -> 组件外层 host 归 identity 并集(§7.5 整体 union)。
// 字段级(bindFiberCommit):render 期 __readProp 记 fiberReads -> commit 期按 fiber 定案字段边(§7.6)。
// 数据源识别不 by prop 名:扫所有 props,按 __wdpp_fields(含低熵)/objectIndex/带照叶子 三档信号。
import { getStamp, expandBits } from './value-index.js';
import { smGet } from './sm.js';
import { getFiberReads } from './babel-runtime.js';
import { recordEdge } from './graph.js';

const LEAF_SAMPLE = 20; // 带照叶子采样上限(防大对象全扫)
const LEAF_MIN = 3;     // >=N 带照叶子才认为对象是数据源(抗偶然碰撞)

// 对象的 identity 护照(字段位并集),三档信号优先级:
// 1. __wdpp_fields(含所有字段,含低熵 status;深拷贝断) 2. objectIndex 子树并集(不含低熵;深拷贝断) 3. (降级在 leafUnion)
export function objectIdentity(obj) {
  if (!obj || typeof obj !== 'object') return 0n;
  if (obj.__wdpp_fields) {
    let u = 0n;
    for (const fk in obj.__wdpp_fields) u |= obj.__wdpp_fields[fk];
    if (u) return u;
  }
  const s = getStamp(obj); // objectIndex(子树并集)
  if (s && s.passport) return s.passport;
  return 0n;
}

// 深拷贝断 identity/__wdpp_fields 时,降级扫对象叶子值(采样),若足够多带照,返回护照并集。
// 优先 byVal 反查(完整 fieldMap,含低熵 status -- 非低熵值反查原 record 的字段集);
// 降级值索引 getStamp(不含低熵)。byVal 抗深拷贝(值不变),通用(不 by case)。
export function leafUnion(obj) {
  if (!obj || typeof obj !== 'object') return 0n;
  const byVal = (typeof globalThis !== 'undefined' && globalThis.__wdpp_byVal) || null;
  let union = 0n, hits = 0, sampled = 0;
  for (const k in obj) {
    if (sampled >= LEAF_SAMPLE) break;
    const v = obj[k];
    if (v === null || v === undefined || typeof v === 'object') continue;
    sampled++;
    if (byVal && byVal[v]) {
      // byVal[v] = 原 record 的 fieldMap(含所有字段,含低熵 status);并集
      for (const fk in byVal[v]) union |= byVal[v][fk];
      hits++;
      continue;
    }
    const s = getStamp(v);
    if (s && s.passport) { union |= s.passport; hits++; }
  }
  return hits >= LEAF_MIN ? union : 0n;
}

// 扫所有 props(不枚举名,不 by case),返回数据源对象的 identity 护照并集。
// 只识别对象数据源(块级);string/number prop 走字段级(onDomWrite/fiberReads),不在此。
export function dataSourcesBits(props) {
  if (!props || typeof props !== 'object') return 0n;
  let union = 0n;
  for (const k in props) {
    const v = props[k];
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (!item || typeof item !== 'object') continue;
        const ib = objectIdentity(item) || leafUnion(item);
        if (ib) union |= ib;
      }
      continue;
    }
    const bits = objectIdentity(v) || leafUnion(v);
    if (bits) union |= bits;
  }
  return union;
}

// fiber 子树最浅 host DOM 元素(BFS 第一个 nodeType===1)
function findHost(fiber) {
  const queue = [fiber.child];
  while (queue.length) {
    const f = queue.shift();
    if (!f) continue;
    if (f.stateNode && f.stateNode.nodeType === 1) return f.stateNode;
    if (f.child) queue.unshift(f.child);
    if (f.sibling) queue.push(f.sibling);
  }
  return null;
}

// 通用找 React rootFiber:遍历 body 子树找带 __reactContainer$ key 的元素(任意 root id,不 by case)。
// 缓存:rootFiber 引用稳定(createRoot 一次),rerender 不换;HMR/重挂载罕见(dev 可接受)。
let _rootFiberCache = null;
function getRootFiber(doc) {
  if (_rootFiberCache) return _rootFiberCache;
  const body = doc.body;
  if (!body) return null;
  // 先查 body 自身 + 直接子元素(常见:root div 在 body 下)
  const direct = [body, ...(body.children || [])];
  for (const el of direct) {
    if (!el || el.nodeType !== 1) continue;
    for (const k in el) {
      if (k.startsWith('__reactContainer$')) { _rootFiberCache = el[k]; return _rootFiberCache; }
    }
  }
  // 兜底:深度遍历(react root 可能嵌套)
  const stack = [...(body.children || [])];
  while (stack.length) {
    const el = stack.pop();
    if (!el || el.nodeType !== 1) continue;
    for (const k in el) {
      if (k.startsWith('__reactContainer$')) { _rootFiberCache = el[k]; return _rootFiberCache; }
    }
    for (const c of el.children || []) stack.push(c);
  }
  return null;
}

const yield_ = () => new Promise((r) => setTimeout(r, 0));

// 块级归因:每个 props 含带照对象的 fiber -> 其外层 host 归 identity 并集(block 置信度)。
// 不限"最外层":每个有数据源的组件都归,查询靠 lookup 祖先回退到最近祖先 host。
export async function bindComponentData(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return 0;
  const rootFiber = getRootFiber(doc);
  if (!rootFiber) return 0;
  let count = 0;
  const stack = [rootFiber];
  const seen = new Set();
  let visited = 0;
  const MAX = 20000;
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    if (++visited > MAX) break;
    if (visited % 200 === 0) await yield_();
    const props = f.memoizedProps;
    if (props && typeof props === 'object' && !(f.stateNode && f.stateNode.nodeType === 1)) {
      let bits = 0n;
      try { bits = dataSourcesBits(props); } catch {}
      if (bits) {
        let host = null;
        try { host = findHost(f); } catch {}
        if (host) {
          for (const id of expandBits(bits)) recordEdge(id, host, 'data', 'block', null, null);
          count++;
        }
      }
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  return count;
}

// 字段级归因(fiberReads commit 定案,§7.6):render 期 __readProp 记的 [obj,key] ->
// commit 期查字段护照(smGet 优先,深拷贝断则降级值通道) -> recordEdge 字段边到 fiber host。
// 仅覆盖 L2 插桩的 app 代码读取;库内部(未插桩)无 fiberReads -> 自动降级块级(诚实)。
export async function bindFiberCommit(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return 0;
  const rootFiber = getRootFiber(doc);
  if (!rootFiber) return 0;
  let count = 0;
  const stack = [rootFiber];
  const seen = new Set();
  let visited = 0;
  const MAX = 20000;
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    if (++visited > MAX) break;
    if (visited % 200 === 0) await yield_();
    const reads = getFiberReads(f);
    if (reads && reads.length) {
      const host = findHost(f);
      if (host) {
        for (const [obj, key] of reads) {
          let slot = (obj != null && typeof obj === 'object') ? smGet(obj, key) : 0n; // SM 字段护照(含低熵)
          if (!slot && obj != null && typeof obj === 'object') {
            // 深拷贝断 SM -> 降级对象并集(objectIdentity/leafUnion byVal,含所有字段含低熵),
            // 而非单字段值通道(obj[key] 低熵如 length=0 会 miss)
            slot = objectIdentity(obj) || leafUnion(obj);
          }
          if (slot) {
            for (const id of expandBits(slot)) recordEdge(id, host, 'data', 'fiber', null, null);
            count++;
          }
        }
      }
    }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  return count;
}

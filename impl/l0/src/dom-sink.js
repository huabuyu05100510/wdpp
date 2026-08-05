// dom-sink.js - DOM 写入拦截 + onDomWrite 查值画边 + 相邻文本拼接 + MutationObserver 清理
// 规范:WDPP-L0 §4.3。主通道:CharacterData.nodeValue/data + setAttribute + property 表。
// 纯通用:不解析 antd columns / data-test(旧声明通道已移除),库内变换墙靠 react-hack fiber 反查 + byVal 解。

import { getStamp, expandBits, getEntityKey } from './value-index.js';
import { controlGet, getControlStack } from './control-index.js';
import { recordEdge, clearEdges } from './graph.js';
import { bindComponentData, bindFiberCommit } from './component-bind.js';
import { getGraphNodeIdByFieldId } from './stamp-origin.js';
import { defaultGraph } from './graph-v2.js';

const patched = Symbol('wdpp_patched');

// ============ 文本主通道:CharacterData.nodeValue / .data ============
// React/Vue 写文本主要走这条(不是 textContent)
patchAccessor(CharacterData.prototype, 'nodeValue');
patchAccessor(CharacterData.prototype, 'data');
patchAccessor(Node.prototype, 'textContent'); // 少数路径,在 Node 上
patchAccessor(Element.prototype, 'innerHTML', 'html');

// createTextNode:创建时拿到初始值
const _createTextNode = document.createTextNode.bind(document);
document.createTextNode = function (data) {
  const node = _createTextNode(String(data));
  onDomWrite(node, data);
  return node;
};

// ============ 属性:setAttribute + 已知属性 property 表 ============
const _setAttribute = Element.prototype.setAttribute;
Element.prototype.setAttribute = function (name, value) {
  const r = _setAttribute.call(this, name, value);
  onDomWrite(this, value, name);
  return r;
};

// React 对已知属性走 property 赋值,不走 setAttribute。按 React DOM property 表逐接口 patch(最小集)
patchAccessor(HTMLInputElement.prototype, 'value');
patchAccessor(HTMLInputElement.prototype, 'checked');
patchAccessor(HTMLImageElement.prototype, 'src');
patchAccessor(HTMLAnchorElement.prototype, 'href');
patchAccessor(Element.prototype, 'className', 'class');
patchAccessor(Element.prototype, 'id');
patchAccessor(Element.prototype, 'title');
if (typeof HTMLInputElement !== 'undefined') patchAccessor(HTMLInputElement.prototype, 'placeholder');
if (typeof HTMLImageElement !== 'undefined') patchAccessor(HTMLImageElement.prototype, 'alt');
if (typeof HTMLInputElement !== 'undefined') patchAccessor(HTMLInputElement.prototype, 'disabled');
if (typeof HTMLOptionElement !== 'undefined') patchAccessor(HTMLOptionElement.prototype, 'selected');
if (typeof HTMLButtonElement !== 'undefined') patchAccessor(HTMLButtonElement.prototype, 'disabled');

// style 属性
if (typeof CSSStyleDeclaration !== 'undefined') {
  const _setProperty = CSSStyleDeclaration.prototype.setProperty;
  CSSStyleDeclaration.prototype.setProperty = function (name, value) {
    const r = _setProperty.call(this, name, value);
    onDomWrite(this.ownerNode || this, value, `style.${name}`);
    return r;
  };
}

// innerHTML:substring 匹配(字段值可能是 HTML 片段的一部分)
if (typeof Element !== 'undefined') {
  const _innerHTML = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (_innerHTML?.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      ..._innerHTML,
      set(val) {
        _innerHTML.set.call(this, val);
        onDomWrite(this, val, 'html');
      },
    });
  }
}

// hydration 全 DOM 扫描:分层归因(字段级 fiberReads + 块级 props 带照对象)。async 分片 yield 不阻塞。
// 注:onDomWrite 全 DOM walk 省略(React 客户端渲染的 DOM 写入已由 patchAccessor 实时记边;
// 重扫是给 SSR 水合/异步渲染补 fiber 归因)。需要时手动调 window.__wdpp__.scanHydration()。
export async function scanHydration(root) {
  const doc = root || (typeof document !== 'undefined' ? document : null);
  if (!doc) return;
  await bindFiberCommit(doc);    // 字段级:render 期 fiberReads -> commit 期定案(app 代码 L2 读取)
  await bindComponentData(doc);  // 块级:props 含带照对象 -> 外层 host 归 identity 并集
}
// hydration 扫描不自动触发(避免干扰测试/增加启动开销)。
// 用户在 hydration 完成后显式调 window.__wdpp__.scanHydration()。

function patchAccessor(proto, prop, attrName) {
  if (proto[patched]?.[prop]) return;
  const desc = Object.getOwnPropertyDescriptor(proto, prop);
  if (!desc || !desc.set) return;
  Object.defineProperty(proto, prop, {
    ...desc,
    set(val) {
      desc.set.call(this, val);
      onDomWrite(this, val, attrName === undefined ? prop : attrName);
    },
  });
  if (!proto[patched]) proto[patched] = {};
  proto[patched][prop] = true;
}

// ============ onDomWrite:查值画边(数据边 + 控制边,始终都查)============
// 为 DOM 节点生成稳定的 graph id
function domNodeGraphId(node) {
  // 用 dom 节点本身的引用作为图节点 id(同一 dom 节点始终是同一图节点)
  // 注:引用作 key 在 Map 表现良好;但序列化时会丢失
  // 改进:用 node-id-like 字符串(weak ref to id map)
  if (!node._wdpp_graph_id) {
    // 简单方案:用 node 的内部 id(浏览器原生 nodeId 属性,但 jsdom 不支持)
    // 退而用 weakmap
    if (!domNodeGraphId._map) domNodeGraphId._map = new WeakMap();
    if (!domNodeGraphId._map.has(node)) {
      domNodeGraphId._map.set(node, `dom#${domNodeGraphId._seq++}`);
    }
    node._wdpp_graph_id = domNodeGraphId._map.get(node);
  }
  return node._wdpp_graph_id;
}
domNodeGraphId._seq = 1;

function onDomWrite(node, value, attrName) {
  if (value === null || value === undefined) return;
  const v = (typeof value === 'object') ? String(value) : value;

  let stamp = getStamp(v);
  // 相邻文本拼接查询:LV.{level} -> 两文本节点 "LV."+"7",拼 "LV.7" 命中
  if (!stamp && isTextNode(node)) {
    stamp = tryConcatAdjacent(node);
  }

  // 控制边:controlIndex + 控制上下文栈(if/while/for 体)
  const ctrls = controlGet(v);
  const stack = getControlStack();
  const stackIds = stack.length ? expandBits(stack[stack.length - 1]) : []; // 取栈顶

  if (!stamp && ctrls.length === 0 && stackIds.length === 0) return; // 字面量且无控制条件,短路

  clearEdges(node); // 重写先清旧边(生命周期)
  const ek = getEntityKey(v); // 记录级血缘
  // 数据边:置信度按 count 分级(exact/value-match/collision)
  if (stamp) {
    const conf = stamp.collision ? 'collision'
               : stamp.count > 1 ? 'value-match'
               : 'exact';
    for (const id of expandBits(stamp.passport)) recordEdge(id, node, 'data', conf, attrName, ek);

    // B-2 集成:同步建图边(api-field → dom)
    // 注:v1 边的正向记录保留;v2 图边同时建立
    // dom 节点 graph id 用 weakmap + seq
    const domGid = domNodeGraphId(node);
    defaultGraph.addNode({
      type: 'dom',
      id: domGid,
      meta: { attr: attrName, nodeType: node.nodeType },
    });
    for (const fieldId of expandBits(stamp.passport)) {
      const sourceGid = getGraphNodeIdByFieldId(fieldId);
      if (sourceGid) {
        defaultGraph.addEdge({
          type: 'write',
          from: sourceGid,
          to: domGid,
          meta: { attr: attrName, confidence: conf, entityKey: ek },
        });
      }
    }
  }
  // 控制边:controlIndex(内联 &&/三元)
  for (const c of ctrls) {
    for (const id of expandBits(c.passport)) recordEdge(id, node, 'control', c.conf, attrName, ek);
  }
  // 控制边:上下文栈(if/while/for 体,标 approx)
  for (const id of stackIds) recordEdge(id, node, 'control', 'approx', attrName, ek);
}

// 控制边在 onDomWrite 内一并记(controlGet)。L1 Babel 插件在求值点 controlAdd 登记条件护照。

export { onDomWrite };

function isTextNode(node) {
  return node && node.nodeType === 3; // Node.TEXT_NODE
}

// 拼接相邻文本兄弟查询。挂载规则:仅文本节点、单值 miss 时、同一父元素下相邻文本、不跨元素边界
// P1 修复:原实现从 parent.firstChild 累积,会把无关前缀也拼进去(误命中)。
// 改为:从 node 自身向前回溯(到上一个 Element 停止) + 向后遍历(到下一个 Element 停止),
//      只拼接真正相邻的兄弟文本节点,不包含无关前缀。
function tryConcatAdjacent(node) {
  const parent = node.parentNode;
  if (!parent) return null;
  if (node.nodeType !== 3) return null; // 仅文本节点

  // 向后拼接:从 node.nextSibling 开始,到第一个 Element 停止
  let combined = node.nodeValue;
  let n = node.nextSibling;
  while (n) {
    if (n.nodeType === 3) combined += n.nodeValue;
    else break; // 遇元素边界停止
    n = n.nextSibling;
  }

  // 向前回溯:从 node.previousSibling 开始,到第一个 Element 停止
  n = node.previousSibling;
  while (n) {
    if (n.nodeType === 3) combined = n.nodeValue + combined;
    else break; // 遇元素边界停止
    n = n.previousSibling;
  }

  if (combined === node.nodeValue) return null; // 没有兄弟,拼了也等于自己
  return getStamp(combined);
}

// ============ MutationObserver:节点移除/合并清理 ============
// P0 修复:递归清理 removedNode 子树,避免 Suspense 卸载 fallback 后残留幽灵边
// 旧实现:只清理 removedNodes 顶层节点(子节点的边残留,变成幽灵边)
// 新实现:clearSubtree 递归清理整棵子树的边
function clearSubtree(root) {
  if (!root) return;
  // BFS 清理 root + 所有后代
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    clearEdges(node);
    // 收集子节点
    const childNodes = node.childNodes;
    if (childNodes && childNodes.length) {
      for (let i = 0; i < childNodes.length; i++) {
        stack.push(childNodes[i]);
      }
    }
  }
}

const mo = new MutationObserver((muts) => {
  for (const m of muts) {
    for (const n of m.removedNodes) clearSubtree(n);
  }
});
mo.observe(document, { childList: true, subtree: true });

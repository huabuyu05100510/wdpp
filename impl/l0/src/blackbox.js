// blackbox.js - 黑盒处理:Canvas / WebGL / Worker
// 规范:WDPP §7.13 + §7.12。黑盒边界(物理/跨上下文)拦截,把输入 taint 标到宿主。
//
// 核心思想:
//   - Canvas / WebGL:绘制输出不可观测(像素),但输入参数可知
//     → patch 关键绘制 API,把 args 的 taint union 到 canvas 元素上
//   - Worker:跨上下文,内部 fetch/DOM 不可见,只有 postMessage 是边界
//     → patch Worker.postMessage + onmessage,值传递时继承 taint
//
// 设计原则:不假装精确(无法在黑盒内追溯),只标"参与了输入"

import { getStamp, stampValuePassport } from './value-index.js';
import { smGet } from './sm.js';
import { defaultGraph } from './graph-v2.js';
import { recordEdge } from './graph.js';

let started = false;

/**
 * 给 canvas 节点"盖戳":把 args taint union 到 canvas 节点
 * @param {HTMLCanvasElement} canvas
 * @param {any[]} args - 绘制调用的参数
 */
function stampCanvasFromArgs(canvas, args) {
  if (!canvas || canvas.nodeType !== 1) return;

  // 收集 args 的 taint
  let union = 0n;
  for (const arg of args) {
    if (arg == null) continue;
    // 字符串值
    if (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean') {
      const stamp = getStamp(arg);
      if (stamp) union |= stamp.passport;
    }
    // 对象值(identity)
    if (typeof arg === 'object') {
      const stamp = getStamp(arg);
      if (stamp) union |= stamp.passport;
    }
    // DOM 节点(image, canvas, video)
    if (arg && arg.nodeType === 1) {
      // DOM 节点本身可能带 taint,但我们不查 DOM 节点的 taint
      // (因为这是绘制输入,语义上"被画了")
    }
  }

  if (union === 0n) return;

  // 给 canvas 节点"虚拟盖戳":通过 __wdpp_fields 记录
  try {
    canvas.__wdpp_fields = canvas.__wdpp_fields || {};
    canvas.__wdpp_fields.__canvas_blackbox__ = union;
    // 也给 canvas 元素的 SM 加一个伪槽位
    if (smGet) {
      // 不直接调用 smSet,而是用 __wdpp_fields 标记
    }
  } catch {}

  // 记录 v1 边(canvas 是 dom,绘制的输入字段 → canvas)
  // 这里我们用伪 field id 标记
  try {
    // 简化:为每个 bit 创建一个虚拟边
    const ids = [];
    for (let id = 0n, bit = 1n; bit <= union; bit <<= 1n, id++) {
      if (union & bit) ids.push(Number(id));
    }
    // 不直接展开 bit(可能太大),用 stamp API
    // 这里只标一个 v2 图节点 + v1 边
    const stamp = { passport: union, count: ids.length, collision: false };
    if (stamp.count > 0) {
      // 用 v1 graph 的 recordEdge
      // 但 recordEdge 需要 fieldId(number),不直接接受 BigInt
      // 简化方案:用 v2 graph
      const domGid = `dom#canvas-blackbox-${Date.now()}-${Math.random()}`;
      defaultGraph.addNode({
        type: 'dom',
        id: domGid,
        meta: { canvas: true, nodeType: 1 },
      });
      defaultGraph.addEdge({
        type: 'write',
        from: 'canvas-blackbox-input',
        to: domGid,
        meta: { confidence: 'block', reason: 'canvas-blackbox', argsCount: args.length },
      });
    }
  } catch (e) {
    // 静默失败
  }
}

// 需要拦截的 Canvas 2D 绘制方法(参数含值 taint 的)
const CANVAS_DRAW_METHODS = [
  'fillText',         // 文本(text, x, y, ...)
  'strokeText',       // 描边文本
  'fill',             // 填充 path
  'stroke',           // 描边
  'drawImage',        // 绘制图像(image, ...)
  'drawFocusIfNeeded',// a11y 焦点
  'putImageData',     // 像素数据
  'fillRect',         // 矩形
  'strokeRect',
  'fillText',
  // WebGL 方法(uniform 等参数是值)
  'uniform1f', 'uniform1i', 'uniform2f', 'uniform2i', 'uniform3f', 'uniform3i', 'uniform4f', 'uniform4i',
  'uniform1fv', 'uniform1iv', 'uniform2fv', 'uniform2iv', 'uniform3fv', 'uniform3iv', 'uniform4fv', 'uniform4iv',
  'uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv',
  'vertexAttrib1f', 'vertexAttrib2f', 'vertexAttrib3f', 'vertexAttrib4f',
];

const patchedPrototypes = new WeakSet();

function patchCanvasPrototype(prototype, label) {
  if (!prototype || patchedPrototypes.has(prototype)) return;
  patchedPrototypes.add(prototype);

  for (const name of CANVAS_DRAW_METHODS) {
    const desc = Object.getOwnPropertyDescriptor(prototype, name);
    if (!desc || typeof desc.value !== 'function') continue;
    if (desc.value.__wdpp_patched) continue;

    const _original = desc.value;
    const wrapped = function (...args) {
      // 拦截:把 args 的 taint 标到 canvas 元素
      try {
        // this 是 context(canvasRenderingContext2D 或 webglRenderingContext)
        // .canvas 是宿主 canvas
        const canvas = this.canvas || (this._canvas);
        if (canvas) stampCanvasFromArgs(canvas, args);
      } catch {}
      return _original.apply(this, args);
    };
    Object.defineProperty(prototype, name, {
      ...desc,
      value: wrapped,
      writable: true,
      configurable: true,
    });
    wrapped.__wdpp_patched = true;
  }
}

function patchCanvas() {
  if (typeof CanvasRenderingContext2D !== 'undefined') {
    patchCanvasPrototype(CanvasRenderingContext2D.prototype, 'canvas-2d');
  }
  if (typeof WebGLRenderingContext !== 'undefined') {
    patchCanvasPrototype(WebGLRenderingContext.prototype, 'webgl');
  }
  if (typeof WebGL2RenderingContext !== 'undefined') {
    patchCanvasPrototype(WebGL2RenderingContext.prototype, 'webgl2');
  }
}

// ============ Worker 黑盒处理 ============

function patchWorkerPrototype() {
  if (typeof Worker === 'undefined') return;
  const proto = Worker.prototype;
  if (patchedPrototypes.has(proto)) return;
  patchedPrototypes.add(proto);

  // postMessage(发送侧):msg 的 taint 应该被接收方继承
  const _postMessage = proto.postMessage;
  proto.postMessage = function (msg, ...args) {
    try {
      if (msg != null) {
        const stamp = getStamp(msg);
        if (stamp) {
          // 把 taint 标到 msg 上(string 化)
          // 接收方 onmessage 时反查 stamp
          if (typeof msg === 'object' && !msg.__wdpp_postMessageTaint) {
            try {
              msg.__wdpp_postMessageTaint = stamp.passport;
            } catch {}
          }
        }
      }
    } catch {}
    return _postMessage.call(this, msg, ...args);
  };

  // onmessage setter(接收侧):捕获 set onmessage
  const desc = Object.getOwnPropertyDescriptor(proto, 'onmessage');
  if (desc && desc.set) {
    Object.defineProperty(proto, 'onmessage', {
      configurable: true,
      enumerable: desc.enumerable,
      get() { return desc.get?.call(this); },
      set(handler) {
        const wrapped = (event) => {
          try {
            const data = event.data;
            if (data && typeof data === 'object' && data.__wdpp_postMessageTaint) {
              // 恢复 taint
              stampValuePassport(data, data.__wdpp_postMessageTaint);
            }
          } catch {}
          return handler.call(this, event);
        };
        desc.set.call(this, wrapped);
      },
    });
  }

  // addEventListener('message') 也需要拦截
  // 简化:留给全局 addEventListener('message') patch(在 stamp-origin.js 已覆盖)
}

/**
 * 启动黑盒处理(Canvas / WebGL / Worker)
 */
export function startBlackbox() {
  if (started) return;
  started = true;

  try {
    patchCanvas();
    patchWorkerPrototype();
  } catch (e) {
    // 某些环境下可能抛错(无 Worker / Canvas),静默
  }
}

/**
 * 检查黑盒处理是否启用
 */
export function isBlackboxActive() {
  return started;
}

/**
 * 手动 stamp(供测试/高级用法)
 */
export { stampCanvasFromArgs };
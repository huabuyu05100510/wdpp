// runtime.js - 把 L0 运行时 + L1 helper 注入浏览器全局
// L0 runtime patches fetch/XHR/DOM(副作用 import);L1 helper 挂 window 供 Babel 产物调用
import '@wdpp/index.js';                                  // L0:patch + install
import { __recover, __controlAnd, __controlOr, __controlTernary, __readSlot } from '@wdpp/babel-runtime.js';
import { install } from '@wdpp/index.js';

install({ expose: true }); // opt-in:挂 window.__wdpp__

// L1 helper 挂全局(Babel 插件产物的裸标识符 __recover 等解析到这)
Object.assign(globalThis, { __recover, __controlAnd, __controlOr, __controlTernary, __readSlot });

console.log('WDPP L0+L1 ready. window.__wdpp__ 可用。');

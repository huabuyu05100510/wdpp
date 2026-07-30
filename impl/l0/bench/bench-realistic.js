// bench-realistic.js - 真实场景召回/帧率:模拟典型 app 页面渲染(列表+详情+变换+控制边)
// 运行:node impl/l0/bench/bench-realistic.js
// 比 micro bench 更接近真实:多组件、变换、控制边、属性、相邻文本、字面量混合。
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>');
const { window } = dom;
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  CharacterData: window.CharacterData, HTMLInputElement: window.HTMLInputElement,
  HTMLImageElement: window.HTMLImageElement, HTMLAnchorElement: window.HTMLAnchorElement,
  MutationObserver: window.MutationObserver,
});
await import('../src/dom-sink.js');
const { install } = await import('../src/index.js');
const { stampOrigin } = await import('../src/stamp-origin.js');
const { __recover, __controlAnd, __readSlot } = await import('../src/babel-runtime.js');
install({ expose: true });

// 模拟 API 响应(真实形状:用户 + 列表 + 配置)
const api = {
  user: { name: 'Ada-Lovelace', level: 42, isVip: true, avatar: 'ada.png', bio: 'pioneer' },
  posts: Array.from({ length: 20 }, (_, i) => ({
    id: `post-${i}`, title: `Post-Title-${i}-unique`, views: i * 100, published: i % 2 === 0,
  })),
  config: { theme: 'dark', lang: 'zh' },
};
stampOrigin(api, 'GET /home');

const root = window.document.getElementById('root');
const wdpp = window.__wdpp__;

// 模拟 React 渲染:造 DOM,混合数据边/变换/控制边/属性/字面量
function render() {
  root.innerHTML = '';
  // 数据边:name
  const h1 = window.document.createElement('h1');
  h1.textContent = api.user.name;
  root.appendChild(h1);
  // 变换:toUpperCase(L1)
  const h2 = window.document.createElement('h2');
  h2.textContent = __recover(api.user.name.toUpperCase(), [api.user.name]);
  root.appendChild(h2);
  // 相邻文本:LV.{level}
  const span = window.document.createElement('span');
  root.appendChild(span);
  span.appendChild(window.document.createTextNode('LV.'));
  span.appendChild(window.document.createTextNode(api.user.level));
  // 属性:avatar
  const img = window.document.createElement('img');
  img.setAttribute('src', api.user.avatar);
  root.appendChild(img);
  // 控制边:isVip && VIP(内联)
  if (api.user.isVip) {
    const em = window.document.createElement('em');
    em.textContent = __controlAnd(api.user.isVip, __readSlot(api, ['user','isVip']), () => 'VIP');
    root.appendChild(em);
  }
  // 列表:posts.map(title -> li)
  const ul = window.document.createElement('ul');
  for (const p of api.posts) {
    const li = window.document.createElement('li');
    li.textContent = p.title;
    ul.appendChild(li);
  }
  root.appendChild(ul);
  // 字面量(反例)
  const footer = window.document.createElement('footer');
  footer.textContent = '© 2026 写死的版权';
  root.appendChild(footer);
  // 变换:toFixed(views)(L1) -- 用 posts[1].views=100(非低熵)
  const views = window.document.createElement('div');
  views.textContent = __recover(api.posts[1].views.toFixed(0), [api.posts[1].views]);
  root.appendChild(views);
}

// ===== 召回统计 =====
const expected = [
  { desc: 'name 数据边', find: () => wdpp.lookup(root.querySelector('h1')).some(e => e.edgeType === 'data') },
  { desc: 'name.toUpperCase 变换(L1)', find: () => wdpp.lookup(root.querySelector('h2')).some(e => e.edgeType === 'data') },
  { desc: 'level 相邻文本', find: () => {
    const sp = root.querySelector('span');
    return wdpp.lookup(sp).length || [...sp.childNodes].some(n => wdpp.lookup(n).length);
  }},
  { desc: 'avatar 属性边', find: () => wdpp.lookup(root.querySelector('img')).some(e => e.attr === 'src') },
  { desc: 'isVip 控制边', find: () => wdpp.lookup(root.querySelector('em')).some(e => e.edgeType === 'control') },
  { desc: 'posts[0].title 列表项', find: () => wdpp.lookup(root.querySelector('li')).length > 0 },
  { desc: 'posts[1].views toFixed(L1)', find: () => {
    const divs = root.querySelectorAll('div');
    return [...divs].some(d => wdpp.lookup(d).length);
  }},
];
const negatives = [
  { desc: 'footer 字面量无边', find: () => wdpp.lookup(root.querySelector('footer')).length === 0 },
];

render();

console.log('=== 真实场景召回 ===');
let hit = 0;
for (const e of expected) {
  const ok = e.find();
  if (ok) hit++;
  console.log(`  ${ok ? '✔' : '✖'} ${e.desc}`);
}
for (const n of negatives) {
  const ok = n.find();
  console.log(`  ${ok ? '✔' : '✖'} ${n.desc}`);
}
console.log(`\n召回: ${hit}/${expected.length} = ${(hit/expected.length*100).toFixed(0)}%`);
console.log(`反例: ${negatives.filter(n => n.find()).length}/${negatives.length}`);

// ===== 帧率:模拟一次 render 的运行时开销 =====
console.log('\n=== 帧率(单次 render 运行时开销)===');
const ITERS = 200;
const t0 = process.hrtime.bigint();
for (let i = 0; i < ITERS; i++) render();
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`${ITERS} 次 render: ${ms.toFixed(0)}ms 总, ${(ms/ITERS).toFixed(2)}ms/次`);
console.log(`16.67ms 预算下:${(16.67 / (ms/ITERS)).toFixed(0)} 次 render/帧预算`);
console.log(`注:含 jsdom 开销,真实浏览器 DOM 更快;主要看相对量级`);

// ===== 全图统计 =====
const all = wdpp.allEdges();
console.log(`\n=== 全图 ===`);
console.log(`总边数: ${all.length}`);
console.log(`data 边: ${all.filter(e => e.edgeType === 'data').length}`);
console.log(`control 边: ${all.filter(e => e.edgeType === 'control').length}`);
console.log(`exact: ${all.filter(e => e.confidence === 'exact').length}`);
console.log(`value-match: ${all.filter(e => e.confidence === 'value-match').length}`);

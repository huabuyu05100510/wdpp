// bench-recall.js - 召回实测:合成 app 已知数据流,统计 edges found / expected,分 L0/L1
// 运行:node impl/l0/bench/bench-recall.js
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp } from '../src/value-index.js';
import { controlGet, controlAdd } from '../src/control-index.js';
import { recover } from '../src/recovery.js';
import { readSlot } from '../src/sm.js';

// 合成 API 响应(独特值避免碰撞)
const api = {
  user: { name: 'Ada-Lovelace-unique', level: 42, isVip: true, avatar: 'ada-unique.png' },
  items: [
    { id: 'item-id-1', name: 'Item-Alpha-1', price: 99 },
    { id: 'item-id-2', name: 'Item-Beta-2', price: 199 },
  ],
  count: 2,
};
stampOrigin(api, 'GET /app');

// 场景:每个应出边的数据流。l1=true 表示 L0 漏、L1 才命中。
const scenarios = [
  { name: '直接值 name', l1: false, check: () => getStamp('Ada-Lovelace-unique') },
  { name: '属性 avatar', l1: false, check: () => getStamp('ada-unique.png') },
  { name: '数组元素 items[0].name', l1: false, check: () => getStamp('Item-Alpha-1') },
  { name: '类型归一化 level 42->"42"', l1: false, check: () => getStamp('42') },
  { name: '数组元素 items[1].price', l1: false, check: () => getStamp(199) },
  { name: 'count 字段', l1: false, check: () => getStamp(2) },
  {
    name: '变换 toUpperCase(L1)', l1: true,
    check: () => { const r = api.user.name.toUpperCase(); recover(r, [api.user.name]); return getStamp(r); },
  },
  {
    name: '变换 toFixed(L1)', l1: true,
    check: () => { const r = api.items[0].price.toFixed(2); recover(r, [api.items[0].price]); return getStamp(r); },
  },
  {
    name: '拼接 LV.+level(L1)', l1: true,
    check: () => { const r = 'LV.' + api.user.level; recover(r, [api.user.level]); return getStamp(r); },
  },
  {
    name: '控制边 isVip&&VIP(L1)', l1: true, ctrl: true,
    check: () => {
      const condPassport = readSlot(api, ['user', 'isVip']);
      if (api.user.isVip && condPassport) { controlAdd('VIP', condPassport); return { ctrl: controlGet('VIP').length > 0 }; }
      return null;
    },
  },
];

const negatives = [
  { name: '字面量(不在数据)', val: '写死的字面量-不在数据里' },
  { name: '低熵 true', val: true },
  { name: '低熵 0', val: 0 },
  { name: '低熵 ""', val: '' },
  { name: '低熵 1', val: 1 },
];

console.log('=== 召回实测 ===');
let l0Hit = 0, l1Hit = 0;
for (const s of scenarios) {
  const r = s.check();
  const hit = r && (r.passport || r.ctrl);
  if (hit) { (s.l1 ? l1Hit++ : l0Hit++); console.log(`  ✔ ${s.name}`); }
  else console.log(`  ✖ ${s.name} -- ${s.l1 ? '(L1 应命中但漏)' : '(L0 漏,需 L1)'}`);
}

const total = scenarios.length;
console.log(`\nL0 命中(直接/属性/类型归一化/数组): ${l0Hit}`);
console.log(`L1 命中(变换/控制边): ${l1Hit}`);
console.log(`召回率: L0 = ${l0Hit}/${total} = ${(l0Hit/total*100).toFixed(0)}%`);
console.log(`        L1 = ${l0Hit+l1Hit}/${total} = ${((l0Hit+l1Hit)/total*100).toFixed(0)}%`);

console.log('\n=== 反例(不应出边)===');
let negOk = 0;
for (const n of negatives) {
  const ok = !getStamp(n.val);
  if (ok) negOk++;
  console.log(`  ${ok ? '✔' : '✖'} ${n.name} ${ok ? '(无边,正确)' : '(误出边!)'}`);
}
console.log(`反例正确率: ${negOk}/${negatives.length}`);

console.log('\n=== 对照规范宣称 ===');
console.log('规范:L0 ~60% / L1 ~90%(字符串数据边,informative)');
console.log(`实测:L0 ${(l0Hit/total*100).toFixed(0)}% / L1 ${((l0Hit+l1Hit)/total*100).toFixed(0)}%`);
console.log('注:合成场景,真实 app 取决于数据形状(字符串比例/变换密度/碰撞频率)');

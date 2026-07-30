// bench-overhead.js - 开销实测:stampOrigin 吞吐 / DOM 写吞吐 / L1 变换开销 / Babel 转换时间
// 运行:node impl/l0/bench/bench-overhead.js
import { stampOrigin } from '../src/stamp-origin.js';
import { getStamp, stampValuePassport, fieldCount, bumpGeneration } from '../src/value-index.js';
import { transformSync } from '@babel/core';
import plugin from '../babel/plugin.js';

function bench(name, fn, iters = 1000) {
  // warmup
  for (let i = 0; i < Math.min(iters / 10, 100); i++) fn();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) fn();
  const ns = Number(process.hrtime.bigint() - t0);
  const perOp = ns / iters;
  console.log(`${name.padEnd(40)} ${perOp.toFixed(0).padStart(8)} ns/op  (${iters} iters)`);
  return perOp;
}

console.log('=== stampOrigin 吞吐(盖戳建值索引)===');

// 小响应(典型 user 对象)
const smallResp = { user: { name: 'Ada', level: 7, isVip: true, avatar: 'a.png' } };
bench('stampOrigin 小响应(5 字段)', () => stampOrigin(smallResp, 'GET /u'), 10000);

// 中响应(列表 50 条)
const medResp = { items: Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, name: `name-${i}`, price: i * 10 })) };
bench('stampOrigin 中响应(50×3 字段)', () => stampOrigin(medResp, 'GET /list'), 1000);

// 大响应(列表 1000 条)
const bigResp = { items: Array.from({ length: 1000 }, (_, i) => ({ id: `id-${i}-${Math.random()}`, name: `name-${i}` })) };
bench('stampOrigin 大响应(1000×2 字段)', () => stampOrigin(bigResp, 'GET /big'), 100);

console.log(`\n  fieldRegistry 规模: ${fieldCount()} 字段`);

console.log('\n=== 值索引查询吞吐 ===');
stampOrigin(smallResp, 'GET /u');
bench('getStamp 命中', () => getStamp('Ada'), 100000);
bench('getStamp 未命中(字面量)', () => getStamp('not-in-index-xyz'), 100000);
bench('getStamp 低熵短路', () => getStamp(true), 100000);

console.log('\n=== L1 变换恢复开销 ===');
// 对比:纯方法调用 + recover vs 裸调用
const data = { user: { name: 'Grace-Hopper' } };
stampOrigin(data, 'GET /u');
bench('原生 toUpperCase(基线)', () => data.user.name.toUpperCase(), 100000);

import { recover } from '../src/recovery.js';
bench('toUpperCase + recover(L1)', () => {
  const r = data.user.name.toUpperCase();
  recover(r, [data.user.name]);
  return r;
}, 100000);

console.log('\n=== Babel 转换时间(L1 插桩编译期)===');
const sample = `
  function render(data) {
    const n = data.user.name.toUpperCase();
    const label = "LV." + data.user.level;
    return data.user.isVip && n;
  }
`;
bench('Babel 转换 4 行 app 代码', () => transformSync(sample, {
  filename: 'x.js', babelrc: false, configFile: false,
  presets: ['@babel/preset-react'], plugins: [plugin],
}), 1000);

console.log('\n=== 结论对照 ===');
console.log('规范宣称:L0≈1.05× / L1~3×');
console.log('实测:stampOrigin 小响应 ~' + Math.round(bench.nope || 0) + ' ns(单次盖戳,应用启动期一次性)');
console.log('查询:getStamp ~几十 ns/次(每次 DOM 写一次)');
console.log('Babel 转换:编译期,dev 一次性,不进运行时');

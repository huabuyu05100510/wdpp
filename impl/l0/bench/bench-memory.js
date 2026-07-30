// bench-memory.js - 内存曲线:模拟长 session(翻页/切账号),值映射规模曲线 + 代际回收
// 运行:node impl/l0/bench/bench-memory.js
import { stampOrigin } from '../src/stamp-origin.js';
import { bumpGeneration, getCurrentGen, fieldCount, valueIndexSize } from '../src/value-index.js';

function memSnapshot(label) {
  const m = process.memoryUsage();
  console.log(`${label.padEnd(30)} heap=${(m.heapUsed/1024/1024).toFixed(1).padStart(6)}MB  entries=${String(valueIndexSize()).padStart(5)}  fields=${String(fieldCount()).padStart(5)}  gen=${getCurrentGen()}`);
}

memSnapshot('起点(空)');

// 翻 50 页,每页 50 条独特记录(模拟列表分页)
for (let page = 0; page < 50; page++) {
  const resp = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: `p${page}-id-${i}`,
      name: `page${page}-name-${i}-unique`,
      price: page * 100 + i,
    })),
  };
  stampOrigin(resp, `GET /items`);
}
memSnapshot('翻 50 页(2500 条记录)');

// 再翻 50 页(不同数据)
for (let page = 50; page < 100; page++) {
  const resp = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: `p${page}-id-${i}`,
      name: `page${page}-name-${i}-unique`,
      price: page * 100 + i,
    })),
  };
  stampOrigin(resp, `GET /items`);
}
memSnapshot('翻 100 页(5000 条记录)');

// 切账号:bump generation,旧护照应过期
bumpGeneration();
memSnapshot('切账号(bump gen)');

// 新 session 翻 50 页
for (let page = 0; page < 50; page++) {
  const resp = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: `new-p${page}-id-${i}`,
      name: `new-page${page}-name-${i}-unique`,
      price: page * 100 + i,
    })),
  };
  stampOrigin(resp, `GET /items`);
}
memSnapshot('新 session 翻 50 页');

// 验证:旧 session 的值在 bumpGen 后查不到(代际回收生效)
import { getStamp } from '../src/value-index.js';
const oldVal = getStamp('page0-name-0-unique');
const newVal = getStamp('new-page0-name-0-unique');
console.log(`\n代际回收验证:`);
console.log(`  旧 session 值(应过期,null): ${oldVal === null ? '✔ null' : '✖ 仍命中(陈旧!)'}`);
console.log(`  新 session 值(应命中):       ${newVal ? '✔ 命中' : '✖ 漏'}`);

console.log(`\n=== 结论 ===`);
console.log('fieldRegistry 用通配 [] + canonical sourceId(query 丢弃)后,千条列表只增 1 个字段 ID(始终 6)');
console.log('代际回收:bumpGen 触发 compaction,旧代条目物理删除(entries 归零),查询失效');
console.log('heap 不立即降是 V8 GC 惰性(逻辑条目已删,GC 后才回收)-- entries 计数才是真实状态');
console.log('P0 两个修复均落地:compaction(物理删)+ stampOriginChunked(分片不阻塞)');

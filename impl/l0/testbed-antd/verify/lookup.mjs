// lookup.mjs — 端到端召回测量:登录 -> 规则表(/list/table-list) -> 遍历 DOM 文本节点
// 报:live recall + scanHydration 后 recall;分别统计 全页 / 表体(.ant-table-tbody=纯 API 数据区)
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (/error/i.test(m.type())) errors.push(`console.${m.type()}: ${m.text().slice(0, 120)}`); });

// 在指定根下遍历文本节点统计命中。root=document.body 或 .ant-table-tbody
const measure = (rootSel) => page.evaluate((sel) => {
  const wdpp = window.__wdpp__;
  const root = sel ? document.querySelector(sel) : document.body;
  if (!root) return { missingRoot: true };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0, hit = 0;
  const samples = [], missSamples = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const v = (n.nodeValue || '').trim();
    if (!v || v.length < 2) continue;
    total++;
    const edges = wdpp.lookup(n);
    if (edges.length) {
      hit++;
      if (samples.length < 20) samples.push({ text: v.slice(0, 40), fields: [...new Set(edges.map((e) => e.fieldPath))].slice(0, 3) });
    } else if (missSamples.length < 12) missSamples.push(v.slice(0, 40));
  }
  return {
    textTotal: total, textHit: hit,
    recall: total ? ((hit / total) * 100).toFixed(1) + '%' : '0%',
    samples, missSamples,
  };
}, rootSel);

// 1. 登录 admin / ant.design(antd input 用 id,按钮 type=button 文本 "Login")
await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errors.push('goto login: ' + e.message));
await page.waitForTimeout(1200);
await page.locator('input#username').fill('admin').catch((e) => errors.push('fill user: ' + e.message));
await page.locator('input#password').fill('ant.design').catch((e) => errors.push('fill pass: ' + e.message));
await page.getByRole('button', { name: 'Login' }).click().catch((e) => errors.push('click login: ' + e.message));
// 显式等待离开登录页(POST /api/login/account -> currentUser 200 -> 重定向),避免竞态
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 15000 }).catch((e) => errors.push('waitForURL: ' + e.message));
await page.waitForTimeout(1500);
console.log('after login url:', page.url());
console.log('inject:', JSON.stringify(await page.evaluate(() => ({
  wdpp: typeof window.__wdpp__,
  edges: window.__wdpp__?.allEdges?.()?.length,
  fields: window.__wdpp__?.fieldCount?.(),
}))));

// 2. 规则表(数据密集:/api/rule -> name/desc/callNo/status/updatedAt 列)
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errors.push('goto table: ' + e.message));
await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2500);

const summary = () => page.evaluate(() => ({ edges: window.__wdpp__.allEdges().length, fields: window.__wdpp__.fieldCount() }));

// 3. live recall:全页 + 表体
console.log('=== LIVE ===', JSON.stringify(await summary()));
console.log('table-body(纯 API 数据区):', JSON.stringify(await measure('.ant-table-tbody')));
console.log('whole-page:', JSON.stringify({ recall: (await measure(null)).recall }));

// 4. scanHydration 兜底重扫
await page.evaluate(() => window.__wdpp__?.scanHydration?.()).catch((e) => errors.push('scan: ' + e.message));
await page.waitForTimeout(300);
console.log('=== AFTER scanHydration ===', JSON.stringify(await summary()));
console.log('table-body:', JSON.stringify(await measure('.ant-table-tbody')));
const whole = await measure(null);
console.log('whole-page:', JSON.stringify({ recall: whole.recall, samples: whole.samples.slice(0, 6) }));

console.log('=== ERRORS ===');
console.log(errors.slice(-20).join('\n') || '(none)');

await browser.close();

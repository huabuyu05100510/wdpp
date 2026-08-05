import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}`));

await page.goto('http://localhost:3000/signin', { waitUntil: 'networkidle', timeout: 30000 });

// 登录 (database-seed 第一个用户 Heath93 / s3cret)
await page.fill('input[name=username]', 'Heath93');
await page.fill('input[name=password]', 's3cret');
await Promise.all([
  page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}),
  page.click('button:has-text("Sign In")'),
]);
await page.waitForTimeout(3000);
console.log('after login URL:', page.url());

let info = await page.evaluate(() => ({
  edgeCount: window.__wdpp__.allEdges().length,
  fieldCount: window.__wdpp__.fieldCount(),
}));
console.log('after login edges/fields:', JSON.stringify(info));

// 若无数据,尝试直接导航到交易/通知页
if (info.edgeCount === 0) {
  for (const path of ['/transactions', '/notifications', '/contacts']) {
    await page.goto('http://localhost:3000' + path, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    info = await page.evaluate(() => window.__wdpp__.allEdges().length);
    console.log(`navigate ${path} -> edges:`, info);
    if (info > 0) break;
  }
}

// 遍历 DOM:文本节点 + 属性,统计召回 + 采样
const result = await page.evaluate(() => {
  const wdpp = window.__wdpp__;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let total = 0, hit = 0;
  const samples = [];
  const missSamples = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    const v = (n.nodeValue || '').trim();
    if (!v || v.length < 2) continue;
    total++;
    const edges = wdpp.lookup(n);
    if (edges.length) {
      hit++;
      if (samples.length < 20) {
        samples.push({ text: v.slice(0, 40), fields: [...new Set(edges.map((e) => e.fieldPath))].slice(0, 3) });
      }
    } else if (missSamples.length < 15) {
      missSamples.push(v.slice(0, 40));
    }
  }
  return {
    url: location.href,
    edgeCount: wdpp.allEdges().length,
    fieldCount: wdpp.fieldCount(),
    textTotal: total,
    textHit: hit,
    textRecall: total ? ((hit / total) * 100).toFixed(1) + '%' : '0%',
    samples,
    missSamples,
  };
});

console.log('=== RESULT ===');
console.log(JSON.stringify(result, null, 2));
console.log('=== PAGE ERRORS ===');
console.log(errors.slice(-15).join('\n') || '(none)');

await browser.close();

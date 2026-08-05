// probe.mjs — 烟雾测试:WDPP 是否注入成功(global.tsx 是否先于 app 逻辑运行)
// 不登录,只验证 window.__wdpp__ 存在 + patches 已抓到边/字段
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 30000 })
  .catch((e) => logs.push(`goto err: ${e.message}`));

const info = await page.evaluate(() => ({
  url: location.href,
  wdppType: typeof window.__wdpp__,
  wdppKeys: window.__wdpp__ ? Object.keys(window.__wdpp__) : null,
  edgeCount: window.__wdpp__?.allEdges?.()?.length,
  fieldCount: window.__wdpp__?.fieldCount?.(),
  inputs: [...document.querySelectorAll('input')].map((i) => i.name).filter(Boolean),
})).catch((e) => ({ evalErr: e.message }));

console.log('=== INFO ===');
console.log(JSON.stringify(info, null, 2));
console.log('=== LOGS (inject/errors) ===');
const interesting = logs.filter((l) => /wdpp|error|PAGEERROR|fail/i.test(l));
console.log((interesting.length ? interesting : logs).slice(-25).join('\n') || '(none)');

await browser.close();

// full-test.mjs — 一次干净的端到端验证:fresh context,全量报告 + 截图。
import { chromium } from 'playwright';
const BASE = 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();      // 全新 context,无缓存
const page = await ctx.newPage({ viewport: { width: 1280, height: 820 } });

const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

const step = (s) => console.log('— ' + s);

step('goto /user/login');
await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
await page.getByRole('button', { name: 'Login' }).click();
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 15000 });
console.log('  登录后 URL:', page.url());

step('goto /list/table-list');
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });
await page.waitForTimeout(1500);
step('scanHydration');
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(3500); // 等 stamp(observer/subscribe/3s interval)

const rep = await page.evaluate(() => {
  const w = window.__wdpp__;
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')].slice(0, 3).map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => {
      const tEl = td.querySelector('[title*="WDPP"]') || (td.getAttribute('title')?.includes('WDPP') ? td : null);
      return {
        text: td.innerText.trim().replace(/\s+/g, ' ').slice(0, 14),
        title: tEl ? tEl.getAttribute('title').split('\n')[0] : null,
        green: /rgba\(22,\s*163,\s*74/.test(td.outerHTML),
      };
    })
  );
  const allTds = [...document.querySelectorAll('.ant-table-tbody td')];
  return {
    url: location.href,
    wdppType: typeof w,
    titlesLoaded: !!window.__wdpp_titles__,
    edges: w?.allEdges?.()?.length,
    fields: w?.fieldCount?.(),
    greenCellCount: allTds.filter((td) => /rgba\(22,\s*163,\s*74/.test(td.outerHTML)).length,
    totalCells: allTds.length,
    rows,
  };
});

console.log('\n=========== 结果 ===========');
console.log(JSON.stringify(rep, null, 2));

await page.locator('.ant-table-wrapper').first().screenshot({ path: 'full-test.png' });
console.log('\n截图: impl/l0/testbed-antd/verify/full-test.png');

console.log('\n=========== 控制台日志(WDPP/错误)===========');
console.log(logs.filter((l) => /wdpp|error|PAGEERROR/i.test(l)).slice(-20).join('\n') || '(无 WDPP/错误日志)');

await browser.close();

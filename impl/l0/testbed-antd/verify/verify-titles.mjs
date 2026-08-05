// verify-titles.mjs — 验证 wdpp-titles 给表格单元格盖上了 title(native tooltip 不能截图,改读 title 属性)
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);
await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
await page.getByRole('button', { name: 'Login' }).click();
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 15000 });
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(3500); // 等 stamp 周期(subscribe + 3s interval)

const rows = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('.ant-table-tbody tr').forEach((tr, ri) => {
    if (ri > 2) return;
    const cells = [...tr.querySelectorAll('td')].map((td) => ({
      text: td.innerText.trim().replace(/\s+/g, ' ').slice(0, 18),
      title: td.getAttribute('title') || td.querySelector('[title]')?.getAttribute('title') || null,
    }));
    out.push({ row: ri + 1, cells });
  });
  return out;
});
console.log('=== 表格单元格 title 属性(浏览器 hover 就显示这个)===');
rows.forEach((r) => {
  console.log(`Row ${r.row}:`);
  r.cells.forEach((c) => console.log(`   "${c.text}"  →  ${c.title ? '✅ ' + c.title.replace(/\n/g, ' | ') : '❌ 无 title'}`));
});
const withTitle = rows.flatMap((r) => r.cells).filter((c) => c.title).length;
console.log(`\n${withTitle}/${rows.flatMap((r) => r.cells).length} 单元格有 title`);
await browser.close();

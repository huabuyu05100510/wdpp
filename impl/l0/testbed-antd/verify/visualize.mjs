// visualize.mjs — 把 WDPP 血缘"画"出来:表格每个单元格标 🟢命中(标 API 字段)/🔴漏,截图 + 终端逐行映射
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8000';
const SHOT = process.env.SHOT || 'provenance.png'; // 相对 cwd,避开 import.meta.url 的中文 URL 编码

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// 登录
await page.goto(`${BASE}/user/login`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);
await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
await page.getByRole('button', { name: 'Login' }).click();
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 15000 });

// 规则表
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForSelector('.ant-table-tbody tr', { timeout: 15000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(300);

// 工具:取一个 td 的所有命中叶子字段名(fieldPath 形如 ["GET /api/rule","data","[]","callNo"])
const cellsOf = () => page.evaluate(() => {
  const wdpp = window.__wdpp__;
  const leaf = (fp) => { const m = String(fp).match(/"([^"]+)"\]$/); return m ? m[1] : String(fp); };
  const out = [];
  document.querySelectorAll('.ant-table-tbody tr').forEach((tr, ri) => {
    const cells = [];
    [...tr.querySelectorAll('td')].forEach((td) => {
      const text = td.innerText.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (!text) return;
      const fields = new Set();
      const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode;
        if ((n.nodeValue || '').trim().length < 1) continue;
        wdpp.lookup(n).forEach((e) => fields.add(leaf(e.fieldPath)));
      }
      cells.push({ text, field: [...fields].join('|') || null });
    });
    if (cells.length) out.push({ row: ri + 1, cells });
  });
  return out;
});

const rows = await cellsOf();
console.log('=== 表格血缘:单元格文字 → API 字段(🟢命中 / 漏=null) ===');
rows.slice(0, 8).forEach((r) => {
  console.log(`Row ${r.row}:`);
  r.cells.forEach((c) => console.log(`   ${c.field ? '🟢' : '🔴'} "${c.text}"  →  ${c.field ?? '(漏)'}`));
});
const hitCells = rows.flatMap((r) => r.cells).filter((c) => c.field).length;
const allCells = rows.flatMap((r) => r.cells).length;
console.log(`\n单元格级: ${hitCells}/${allCells} 命中`);

// 视觉叠加
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = `
    .wdpp-hit { outline: 2px solid #16a34a !important; outline-offset: -2px; }
    .wdpp-miss { outline: 2px dashed #dc2626 !important; outline-offset: -2px; }
    .wdpp-badge { font-size:10px; background:#16a34a; color:#fff; padding:1px 5px; border-radius:3px;
      margin-left:6px; white-space:nowrap; font-family:ui-monospace,monospace; vertical-align:middle; }
    .wdpp-legend { position:fixed; top:10px; right:10px; background:rgba(0,0,0,.82); color:#fff;
      padding:10px 14px; border-radius:8px; font:13px ui-monospace,monospace; z-index:99999; line-height:1.6; }
  `;
  document.head.appendChild(css);
  const legend = document.createElement('div');
  legend.className = 'wdpp-legend';
  legend.innerHTML = '🟢 边框 = 命中(有 API 血缘)<br>🔴 虚线 = 漏(无血缘)<br>绿标签 = 字段名';
  document.body.appendChild(legend);
  const wdpp = window.__wdpp__;
  const leaf = (fp) => { const m = String(fp).match(/"([^"]+)"\]$/); return m ? m[1] : ''; };
  document.querySelectorAll('.ant-table-tbody td').forEach((td) => {
    const fields = new Set();
    const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode; if ((n.nodeValue || '').trim().length < 1) continue;
      wdpp.lookup(n).forEach((e) => fields.add(leaf(e.fieldPath)));
    }
    if (fields.size) {
      td.classList.add('wdpp-hit');
      const b = document.createElement('span'); b.className = 'wdpp-badge';
      b.textContent = [...fields].join('/'); td.appendChild(b);
    } else if (td.innerText.trim()) td.classList.add('wdpp-miss');
  });
});
await page.waitForTimeout(500);
await page.locator('.ant-table-wrapper').first().screenshot({ path: SHOT });
console.log('\n截图:', SHOT);
await browser.close();

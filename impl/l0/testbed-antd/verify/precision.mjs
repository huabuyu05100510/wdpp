// precision.mjs — antd 规则表 precision/recall 基线测量
// oracle: 拦截 /api/rule 响应 → 按 name 匹配 DOM 行 → 列序 dataIndex 定每格正确字段
// 四态:correct(归因==字段) / wrong(归因≠字段) / missed(未归因) / not-API(option 静态列)
// precision = correct/(correct+wrong); recall = correct/(correct+missed)
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:8000';
const DATA_COLS = ['name', 'desc', 'callNo', 'status', 'updatedAt']; // 列序 0-4; 列5=option(静态)
const OPTION_COL = 5;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (/error/i.test(m.type())) errors.push(`console.${m.type()}: ${m.text().slice(0,120)}`); });

// ---- 捕获 /api/rule 响应作 oracle ----
const records = [];
page.on('response', async (resp) => {
  try {
    if (resp.url().includes('/api/rule') && resp.request().method() === 'GET') {
      const j = await resp.json();
      if (j && Array.isArray(j.data)) records.push(...j.data);
    }
  } catch { /* 非 JSON / 已消费,忽略 */ }
});

// ---- 登录 ----
await page.goto(`${BASE}/user/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
// force: 重启后首编译时 dev overlay iframe 可能拦截点击;force 绕过 actionability(dev 测试场景)
await page.getByRole('button', { name: 'Login' }).click({ force: true });
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 20000 });
await page.waitForTimeout(1500);

// ---- 规则表 ----
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.ant-table-tbody tr', { timeout: 60000 }); // 冷启动懒编译,放宽
await page.waitForTimeout(2500); // 等 stamp + 渲染
await page.evaluate(() => window.__wdpp__?.scanHydration?.()).catch((e) => errors.push('scan: ' + e.message));
await page.waitForTimeout(600);

// oracle: name -> record
const byName = new Map();
for (const r of records) if (r && r.name != null) byName.set(String(r.name).trim(), r);

const result = await page.evaluate((args) => {
  const { byNameArr, dataCols, optionCol } = args;
  const byName = new Map(byNameArr);
  const wdpp = window.__wdpp__;
  const wdppOk = !!wdpp;
  const leaf = (fp) => { const m = String(fp).match(/"([^"]+)"\]$/); return m ? m[1] : String(fp); };
  const attrOf = (td) => {
    const s = new Set();
    if (!wdpp) return s;
    const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      if ((n.nodeValue || '').trim().length < 1) continue;
      if (n.parentElement?.closest('.wdpp-badge')) continue; // 跳过 overlay badge 文本
      wdpp.lookup(n).forEach((e) => s.add(leaf(e.fieldPath)));
    }
    return s;
  };

  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  let correct = 0, wrong = 0, missed = 0, notApiAttributed = 0, notApiSilent = 0, unmatched = 0;
  const perField = {}; dataCols.forEach((f) => perField[f] = { correct: 0, wrong: 0, missed: 0 });
  const samples = { correct: [], wrong: [], missed: [] };

  rows.forEach((tr, ri) => {
    const tds = [...tr.querySelectorAll('td')];
    if (!tds.length) return;
    // 动态定位 name 列(antd 可能注入前置空列/选择列):扫 td 找匹配 record name 的
    // 用排除 overlay badge 的文本(badge 污染 innerText)
    const pureText = (td) => {
      const c = td.cloneNode(true);
      c.querySelectorAll('.wdpp-badge').forEach((e) => e.remove());
      return (c.textContent || '').trim();
    };
    let nameIdx = -1;
    for (let i = 0; i < tds.length; i++) {
      if (byName.has(pureText(tds[i]))) { nameIdx = i; break; }
    }
    if (nameIdx < 0) { unmatched++; return; }
    dataCols.forEach((field, k) => {
      const td = tds[nameIdx + k];
      if (!td) return;
      const text = (td.innerText || '').trim().replace(/\s+/g, ' ');
      const attributed = attrOf(td);
      let cls;
      if (attributed.has(field)) { cls = 'correct'; correct++; perField[field].correct++; }
      else if (attributed.size) { cls = 'wrong'; wrong++; perField[field].wrong++; }
      else { cls = 'missed'; missed++; perField[field].missed++; }
      if (samples[cls].length < 6) samples[cls].push({ row: ri + 1, field, text: text.slice(0, 32), attributed: [...attributed] });
    });
    const optTd = tds[nameIdx + dataCols.length]; // option 紧跟数据列后
    if (optTd) { if (attrOf(optTd).size) notApiAttributed++; else notApiSilent++; }
  });
  return { wdppOk, rowCount: rows.length, correct, wrong, missed, notApiAttributed, notApiSilent, unmatched, perField, samples };
}, { byNameArr: [...byName], dataCols: DATA_COLS, optionCol: OPTION_COL });

const precision = (result.correct + result.wrong) ? (result.correct / (result.correct + result.wrong) * 100).toFixed(1) : 'n/a';
const recall = (result.correct + result.missed) ? (result.correct / (result.correct + result.missed) * 100).toFixed(1) : 'n/a';

console.log('=== antd precision baseline (after scanHydration) ===');
console.log(`__wdpp__ present: ${result.wdppOk} | records captured: ${records.length} | rows: ${result.rowCount} | unmatched rows: ${result.unmatched}`);
console.log(`\nDATA CELLS  correct=${result.correct}  wrong=${result.wrong}  missed=${result.missed}`);
console.log(`OPTION(static)  falsePositive=${result.notApiAttributed}  trueNegative=${result.notApiSilent}`);
console.log(`\n>>> precision = ${precision}%   recall = ${recall}% <<<`);
console.log('\n--- 按字段拆解(告诉 M1 该补哪列)---');
for (const f of DATA_COLS) {
  const p = result.perField[f];
  const tot = p.correct + p.wrong + p.missed;
  console.log(`  ${f.padEnd(10)} ${p.correct}/${tot} correct${p.wrong ? `  (wrong=${p.wrong})` : ''}${p.missed ? `  (missed=${p.missed})` : ''}`);
}
console.log('\n--- 样本 ---');
for (const cls of ['correct', 'wrong', 'missed']) {
  if (result.samples[cls].length) {
    console.log(`  [${cls}]`);
    result.samples[cls].forEach((s) => console.log(`     row${s.row} ${s.field}: "${s.text}" → attributed=[${s.attributed.join(',')}]`));
  }
}

// 叠加截图:绿=correct 红=missed 橙=wrong
await page.evaluate(() => {
  const css = document.createElement('style');
  css.textContent = `.w-correct{outline:2px solid #16a34a!important;outline-offset:-2px}.w-missed{outline:2px dashed #dc2626!important;outline-offset:-2px}.w-wrong{outline:2px solid #ea580c!important;outline-offset:-2px}`;
  document.head.appendChild(css);
});
const colorByCol = (ci, field, attributed) => attributed.has(field) ? 'w-correct' : (attributed.size ? 'w-wrong' : 'w-missed');
await page.evaluate((args) => {
  const { byNameArr, dataCols } = args;
  const byName = new Map(byNameArr);
  const wdpp = window.__wdpp__;
  const leaf = (fp) => { const m = String(fp).match(/"([^"]+)"\]$/); return m ? m[1] : ''; };
  const attrOf = (td) => { const s = new Set(); const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; if ((n.nodeValue||'').trim().length<1) continue; wdpp.lookup(n).forEach(e=>s.add(leaf(e.fieldPath))); } return s; };
  document.querySelectorAll('.ant-table-tbody tr').forEach((tr) => {
    const tds = [...tr.querySelectorAll('td')];
    let nameIdx = -1;
    for (let i = 0; i < tds.length; i++) if (byName.has((tds[i].innerText || '').trim())) { nameIdx = i; break; }
    if (nameIdx < 0) return;
    dataCols.forEach((field, k) => { const td = tds[nameIdx + k]; if (!td) return; const a = attrOf(td); td.classList.add(a.has(field) ? 'w-correct' : (a.size ? 'w-wrong' : 'w-missed')); });
  });
}, { byNameArr: [...byName], dataCols: DATA_COLS });
await page.waitForTimeout(300);
await page.locator('.ant-table-wrapper').first().screenshot({ path: 'precision-antd.png' }).catch(() => {});

console.log('\n截图: precision-antd.png');
console.log('errors:', errors.slice(-8).join('\n') || '(none)');
await browser.close();

// diag-name.mjs - 诊断 antd 规则表 name 列为何值索引 miss
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:8000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(`${BASE}/user/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('input#username').fill('admin');
await page.locator('input#password').fill('ant.design');
await page.getByRole('button', { name: 'Login' }).click({ force: true });
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/user/login'), { timeout: 20000 });
await page.waitForTimeout(1500);
await page.goto(`${BASE}/list/table-list`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.ant-table-tbody tr', { timeout: 60000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(800);

const diag = await page.evaluate(() => {
  const wdpp = window.__wdpp__;
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  const row1 = rows[0];
  const tds = [...row1.querySelectorAll('td')];
  // 找 name td(含 "TradeCode")和 desc td(含 "描述")
  let nameTd = null, descTd = null;
  for (const td of tds) {
    const t = (td.textContent || '').trim();
    if (t.startsWith('TradeCode') && !nameTd) nameTd = td;
    if (t.includes('描述') && !descTd) descTd = td;
  }
  const dump = (td, label) => {
    if (!td) return { label, missing: true };
    const texts = [];
    const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode;
      texts.push({
        value: JSON.stringify(n.nodeValue),
        parentTag: n.parentElement?.tagName,
        lookup: wdpp.lookup(n).map(e => ({ field: e.fieldPath, conf: e.confidence, type: e.type })),
      });
    }
    return { label, html: td.innerHTML.slice(0, 200), texts };
  };
  const allEdges = wdpp.allEdges();
  const nameEdges = allEdges.filter(e => /"name"\]$/.test(e.fieldPath));
  const descEdges = allEdges.filter(e => /"desc"\]$/.test(e.fieldPath));
  // 21 条 name 边记在哪个节点?是否 detached?
  const nameEdgeNodes = nameEdges.slice(0, 6).map(e => {
    const n = e.node;
    if (!n) return { kind: 'null' };
    return {
      nodeType: n.nodeType,
      tag: n.tagName || null,
      text: (n.nodeValue || n.textContent || '').slice(0, 40),
      inDom: document.body.contains(n),
      parentTag: n.parentElement?.tagName || null,
      parentInDom: n.parentElement ? document.body.contains(n.parentElement) : null,
    };
  });
  const inDomNameCount = nameEdges.filter(e => e.node && document.body.contains(e.node)).length;
  return {
    gen: wdpp.getCurrentGen(),
    fieldCount: wdpp.fieldCount(),
    totalEdges: allEdges.length,
    nameFieldEdges: nameEdges.length,
    descFieldEdges: descEdges.length,
    nameEdgesInDom: inDomNameCount,
    nameEdgeNodes,
    nameTd: dump(nameTd, 'name'),
    descTd: dump(descTd, 'desc'),
  };
});

console.log(JSON.stringify(diag, null, 2));
await browser.close();

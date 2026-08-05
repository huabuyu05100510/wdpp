// diag-like.mjs - rwa like-count cell 为何归因到 [description] 不含 likes
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(`${BASE}/signin`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('[data-test="signin-username"] input').fill('Heath93');
await page.locator('[data-test="signin-password"] input').fill('s3cret');
await page.locator('[data-test="signin-submit"]').click({ force: true });
await page.waitForURL((u) => !new URL(u).pathname.startsWith('/signin'), { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.evaluate(() => window.__wdpp__?.scanHydration?.());
await page.waitForTimeout(1000);

const diag = await page.evaluate(() => {
  const wdpp = window.__wdpp__;
  const cells = [...document.querySelectorAll('[data-test="transaction-like-count"]')];
  const cell = cells[0];
  if (!cell) return { error: 'no like-count cell' };
  const w = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (w.nextNode()) {
    const tn = w.currentNode;
    texts.push({ value: JSON.stringify(tn.nodeValue), lookup: wdpp.lookup(tn).map(e => ({ f: e.fieldPath.split(',').pop(), conf: e.confidence })) });
  }
  // 祖先链直接边(noFallback)
  const ancestors = [];
  let cur = cell;
  let d = 0;
  while (cur && d < 10) {
    const edges = wdpp.lookup(cur, { noFallback: true });
    if (edges.length) ancestors.push({ depth: d, tag: cur.tagName, cls: (cur.className || '').slice(0, 30), n: edges.length, sample: edges.slice(0, 3).map(e => ({ f: e.fieldPath.split(',').pop(), conf: e.confidence })) });
    cur = cur.parentElement;
    d++;
  }
  // depth 3 element 的 React fiber props(为何有 description 块边)
  let d3 = cell;
  for (let i = 0; i < 3; i++) d3 = d3?.parentElement;
  let d3props = null;
  if (d3) {
    const fk = Object.keys(d3).find(k => k.startsWith('__reactFiber$'));
    const f = fk ? d3[fk] : null;
    const p = f?.memoizedProps || {};
    d3props = {};
    for (const k in p) {
      const v = p[k];
      if (v == null) d3props[k] = 'null';
      else if (typeof v === 'object') d3props[k] = Array.isArray(v) ? `array[${v.length}]` : (v.$$typeof ? 'react-el' : `obj{${Object.keys(v).slice(0, 6).join(',')}}`);
      else d3props[k] = `${typeof v}:${String(v).slice(0, 24)}`;
    }
  }
  return { texts, ancestors, lookupWithFallback: wdpp.lookup(cell).map(e => ({ f: e.fieldPath.split(',').pop(), conf: e.confidence })),
    d3props,
    likesEdges: wdpp.allEdges().filter(e => e.fieldPath.includes('"likes"')).slice(0, 6).map(e => ({ f: e.fieldPath.split(',').pop(), conf: e.confidence, type: e.edgeType, nodeTag: e.node?.tagName || e.node?.nodeType, inDom: e.node ? document.body.contains(e.node) : false })),
    commentsEdges: wdpp.allEdges().filter(e => e.fieldPath.includes('"comments"')).slice(0, 3).map(e => ({ f: e.fieldPath.split(',').pop(), conf: e.confidence })),
  };
});
console.log(JSON.stringify(diag, null, 2));
await browser.close();

import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 920, height: 720 } });
const errs = [];
p.on('pageerror', e => errs.push('PE: ' + e.message));
p.on('console', m => { if (/error/i.test(m.type())) errs.push('CE: ' + m.text().slice(0, 160)); });
await p.goto('http://localhost:5174/', { waitUntil: 'load', timeout: 30000 });
await p.waitForTimeout(2800);
const diag = await p.evaluate(() => {
  const w = window.__wdpp__;
  const badges = [...document.querySelectorAll('.wdpp-badge')].map(b => b.textContent);
  const panelText = (document.getElementById('wdpp-panel')?.innerText || '').replace(/\s+/g,' ').trim();
  return { wdpp: !!w, edges: w?.allEdges?.()?.length, fields: w?.allEdges?.()?.map(e=>e.fieldPath), badges, panelText: panelText.slice(0,300) };
});
console.log('diag:', JSON.stringify(diag, null, 1));
await p.screenshot({ path: 'demo-overlay.png', fullPage: true });
console.log('errors:', errs.slice(0,6).join('\n') || '(none)');
await b.close();

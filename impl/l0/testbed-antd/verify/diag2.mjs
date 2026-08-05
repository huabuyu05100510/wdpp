import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PE: ' + e.message.slice(0,200)));
await p.goto('http://localhost:8000/user/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(2000);
await p.locator('input#username').fill('admin');
await p.locator('input#password').fill('ant.design');
await p.getByRole('button', { name: 'Login' }).click({ force: true });
await p.waitForURL(u => !new URL(u).pathname.startsWith('/user/login'), { timeout: 20000 });
await p.waitForTimeout(1500);
await p.goto('http://localhost:8000/list/table-list', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForSelector('.ant-table-tbody tr', { timeout: 60000 });
await p.waitForTimeout(3000);
await p.evaluate(() => window.__wdpp__?.scanHydration?.());
await p.waitForTimeout(800);
const diag = await p.evaluate(() => {
  const w = window.__wdpp__;
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  const tds = [...rows[0].querySelectorAll('td')];
  const pureText = td => { const c=td.cloneNode(true); c.querySelectorAll('.wdpp-badge').forEach(e=>e.remove()); return (c.textContent||'').trim(); };
  let nameIdx = -1;
  for (let i=0;i<tds.length;i++){ if(pureText(tds[i]).startsWith('TradeCode')){nameIdx=i;break;} }
  const statusTd = nameIdx>=0 ? tds[nameIdx+3] : null;
  const lookupText = (td) => { if(!td) return null; const w2=document.createTreeWalker(td,NodeFilter.SHOW_TEXT); const out=[]; while(w2.nextNode()){ const n=w2.currentNode; if(!n.nodeValue.trim())continue; if(n.parentElement?.closest('.wdpp-badge'))continue; out.push({text:n.nodeValue.trim(), edges: w.lookup(n).map(e=>e.fieldPath).slice(0,3)}); } return out; };
  return {
    fieldGetVer: globalThis.__fieldGet ? (globalThis.__fieldGet.toString().includes('__lastValue') ? 'NEW' : 'OLD') : 'absent',
    readPropVer: globalThis.__readProp ? (globalThis.__readProp.toString().includes('__lastValue') ? 'NEW' : 'OLD') : 'absent',
    nameIdx, tdCount: tds.length,
    statusHTML: statusTd?.outerHTML.slice(0,350),
    statusTexts: lookupText(statusTd),
    edges: w?.allEdges?.()?.length,
  };
});
console.log(JSON.stringify(diag, null, 1));
console.log('errors:', errs.slice(0,5).join('\n') || '(none)');
await b.close();

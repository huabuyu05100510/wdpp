import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
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
const diag = await p.evaluate(() => {
  const w = window.__wdpp__;
  const edges = w?.allEdges?.() || [];
  const statusEdges = edges.filter(e => /"status"\]$/.test(e.fieldPath));
  const rows = [...document.querySelectorAll('.ant-table-tbody tr')];
  const tds = [...rows[0].querySelectorAll('td')];
  const pureText = td => { const c=td.cloneNode(true); c.querySelectorAll('.wdpp-badge').forEach(e=>e.remove()); return (c.textContent||'').trim(); };
  let nameIdx = -1;
  for (let i=0;i<tds.length;i++){ if(pureText(tds[i]).startsWith('TradeCode')){nameIdx=i;break;} }
  const statusTd = tds[nameIdx+3];
  const fiberKey = statusTd ? Object.keys(statusTd).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) : null;
  const fiberProps = [];
  if (fiberKey) {
    let fiber = statusTd[fiberKey]; let depth = 0;
    while (fiber && depth < 40) {
      const props = fiber.memoizedProps;
      if (props && typeof props === 'object') {
        const dataProps = [];
        for (const k of Object.keys(props)) {
          if (k === 'children') continue;
          const v = props[k];
          if (typeof v === 'string' || typeof v === 'number') dataProps.push({ k, v: String(v).slice(0,24) });
          else if (v && typeof v === 'object' && !Array.isArray(v) && (v.status !== undefined || v.text !== undefined || v.name !== undefined || v.updatedAt !== undefined)) dataProps.push({ k, kind: 'obj', sample: JSON.stringify({status:v.status,name:v.name,updatedAt:v.updatedAt,text:v.text}).slice(0,80) });
        }
        if (dataProps.length) fiberProps.push({ depth, type: typeof fiber.type === 'function' ? (fiber.type.name || fiber.type.displayName || 'fn') : (typeof fiber.type), dataProps: dataProps.slice(0,6) });
      }
      fiber = fiber.return; depth++;
    }
  }
  return { edgeCount: edges.length, statusEdges: statusEdges.length, nameIdx, fiberReachable: !!fiberKey, fiberProps };
});
console.log(JSON.stringify(diag, null, 1));
await b.close();

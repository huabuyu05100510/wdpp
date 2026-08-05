import { chromium } from 'playwright';
const b = await chromium.launch({ headless: true });
const p = await b.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PE: ' + e.message.slice(0,250)));
p.on('console', m => { if (/error/i.test(m.type())) errs.push('CE: ' + m.text().slice(0,250)); });
await p.goto('http://localhost:3000/signin', { waitUntil: 'load', timeout: 30000 });
await p.waitForTimeout(3000);
const diag = await p.evaluate(() => ({
  inputs: document.querySelectorAll('input').length,
  bodyText: (document.body.innerText||'').replace(/\s+/g,' ').trim().slice(0,200),
  wdpp: !!window.__wdpp__,
}));
console.log(JSON.stringify(diag));
console.log('errors:', errs.slice(0,8).join('\n') || '(none)');
await b.close();

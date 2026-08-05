import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`PAGEERROR: ${e.message}`));

await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 })
  .catch((e) => logs.push(`goto err: ${e.message}`));

const info = await page.evaluate(() => ({
  url: location.href,
  wdppType: typeof window.__wdpp__,
  wdppKeys: window.__wdpp__ ? Object.keys(window.__wdpp__) : null,
  edgeCount: window.__wdpp__?.allEdges?.()?.length,
  fieldCount: window.__wdpp__?.fieldCount?.(),
  inputs: [...document.querySelectorAll('input')].map((i) => ({ name: i.name, type: i.type, placeholder: i.placeholder, label: i.getAttribute('aria-label') })),
  buttons: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).slice(0, 5),
  bodyText: document.body.innerText.slice(0, 300),
})).catch((e) => ({ evalErr: e.message }));

console.log('=== INFO ===');
console.log(JSON.stringify(info, null, 2));
console.log('=== LOGS (last 25) ===');
console.log(logs.slice(-25).join('\n'));

await browser.close();

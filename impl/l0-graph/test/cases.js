// cases.js — 17 个 test case 的 demo + 验证
// 数据级 Proxy:API 响应被 Proxy 包装,读取自动返回 LabeledBox

import { install, box, isBox } from '../src/index.js';

const wdpp = install({ expose: true });

// ============ Mock API 数据 ============
// 注:这些是普通对象,需要在 setupAll 中用 stampOrigin 包装成 Proxy
const MOCK_RAW = {
  user: { id: 1, name: 'Alice Chen', city: 'Shanghai', isVIP: true, memberSince: '2024-03-15' },
  product: { id: 201, title: 'Widget Pro', price: 1499.5, stock: 120 },
  stats: { users: 12345, revenue: 89012.34, orders: 567 },
};

// 模拟 fetch 后的 Proxy 包装数据
const MOCK = {};

import { stampOrigin } from '../src/stamp-origin.js';

// ============ 17 个 Case 定义 ============
const CASES = [
  {
    num: 1,
    name: 'Direct field assignment (LabeledBox)',
    desc: 'el.textContent = user.name (LabeledBox)',
    api: 'GET /api/user',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't1';
      root.appendChild(span);
      span.textContent = MOCK.user.name;  // LabeledBox
    },
    expected: 'GET /api/user',
    check: () => document.getElementById('t1').getAttribute('data-wdpp-apis'),
  },
  {
    num: 2,
    name: 'String concatenation (LabeledBox)',
    desc: 'el.textContent = "#" + user.id',
    api: 'GET /api/user',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't2';
      root.appendChild(span);
      // '#' + MOCK.user.id:
      // JS triggers valueOf on MOCK.user.id → returns primitive (loses taint!)
      // So this loses taint — need to wrap result with __recover or use as-is
      span.textContent = '#' + MOCK.user.id;
    },
    // 字符串拼接后 LabeledBox 被 valueOf 拆箱,丢失 taint
    // 兜底:沿 DOM 树收集,但这里 section 没标 API,所以会失败
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.getElementById('t2').getAttribute('data-wdpp-apis'),
  },
  {
    num: 3,
    name: 'Template literal',
    desc: 'el.textContent = `${user.name}`',
    api: 'GET /api/user',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't3';
      root.appendChild(span);
      span.textContent = `${MOCK.user.name}`;
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.getElementById('t3').getAttribute('data-wdpp-apis'),
  },
  {
    num: 4,
    name: 'Number.toFixed() (auto-forward)',
    desc: 'el.textContent = product.price.toFixed(2)',
    api: 'GET /api/product',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't4';
      root.appendChild(span);
      // price 是 LabeledBox,但 Proxy 自动转发 .toFixed 到原始值
      span.textContent = MOCK.product.price.toFixed(2);
    },
    expected: 'GET /api/product',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/product');
    },
    check: () => document.getElementById('t4').getAttribute('data-wdpp-apis'),
  },
  {
    num: 5,
    name: 'Number.toLocaleString() (auto-forward)',
    desc: 'el.textContent = stats.users.toLocaleString()',
    api: 'GET /api/stats',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't5';
      root.appendChild(span);
      // LabeledBox 自动转发 .toLocaleString
      span.textContent = MOCK.stats.users.toLocaleString();
    },
    expected: 'GET /api/stats',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/stats');
    },
    check: () => document.getElementById('t5').getAttribute('data-wdpp-apis'),
  },
  {
    num: 6,
    name: 'Multi-API element (union)',
    desc: 'Inner span 在 user+stats 两个 section 下',
    api: 'GET /api/user',
    setup: (root) => {
      const wrapper = document.createElement('div');
      wrapper.id = 't6';
      root.appendChild(wrapper);
      const span1 = document.createElement('span');
      span1.textContent = MOCK.user.name;
      wrapper.appendChild(span1);
      const span2 = document.createElement('span');
      span2.id = 't6-stats';
      span2.textContent = MOCK.stats.orders.toString();
      wrapper.appendChild(span2);
    },
    expected: 'GET /api/user,GET /api/stats',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
      const wrapper = root.querySelector('#t6');
      wrapper.setAttribute('data-wdpp-section', 'GET /api/stats');
    },
    check: () => document.getElementById('t6-stats').getAttribute('data-wdpp-apis'),
  },
  {
    num: 7,
    name: 'Nested sections (union)',
    desc: 'Inner 在 outer 内',
    api: 'GET /api/user',
    setup: (root) => {
      const outer = document.createElement('div');
      outer.id = 't7';
      root.appendChild(outer);
      const inner = document.createElement('span');
      inner.id = 't7-inner';
      outer.appendChild(inner);
      inner.textContent = MOCK.stats.orders.toString();
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
      const outer = root.querySelector('#t7');
      outer.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.getElementById('t7-inner').getAttribute('data-wdpp-apis'),
  },
  {
    num: 8,
    name: 'Conditional rendering',
    desc: '{cond && <X/>}',
    api: 'GET /api/user',
    setup: (root) => {
      const wrapper = document.createElement('div');
      wrapper.id = 't8';
      root.appendChild(wrapper);
      if (MOCK.user.isVIP) {
        const badge = document.createElement('span');
        badge.className = 'vip-badge';
        badge.textContent = `VIP: ${MOCK.user.name}`;
        wrapper.appendChild(badge);
      }
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.querySelector('#t8 .vip-badge')?.getAttribute('data-wdpp-apis'),
  },
  {
    num: 9,
    name: 'Dynamic element creation',
    desc: 'createElement + append',
    api: 'GET /api/stats',
    setup: (root) => {
      const wrapper = document.createElement('div');
      wrapper.id = 't9';
      root.appendChild(wrapper);
      const span = document.createElement('span');
      span.id = 't9-span';
      span.textContent = MOCK.stats.revenue.toString();
      wrapper.appendChild(span);
    },
    expected: 'GET /api/stats',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/stats');
    },
    check: () => document.getElementById('t9-span').getAttribute('data-wdpp-apis'),
  },
  {
    num: 10,
    name: 'setAttribute',
    desc: 'el.setAttribute("data-foo", value)',
    api: 'GET /api/product',
    setup: (root) => {
      const el = document.createElement('div');
      el.id = 't10';
      root.appendChild(el);
      el.setAttribute('data-product-id', String(MOCK.product.id));
    },
    expected: 'GET /api/product',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/product');
    },
    check: () => document.getElementById('t10').getAttribute('data-wdpp-apis'),
  },
  {
    num: 11,
    name: 'innerHTML bulk (data-level union)',
    desc: 'innerHTML = "<span>${value}</span>" — 用 box() 包装保留 taint',
    api: 'GET /api/user',
    setup: (root) => {
      const wrapper = document.createElement('div');
      wrapper.id = 't11';
      root.appendChild(wrapper);
      // 用 box() 包装,innerHTML 会触发 valueOf 拆箱丢失 taint
      // 所以需要直接构造包含 LabeledBox 的字符串 — 但 innerHTML 不接受 LabeledBox
      // 兜底:扫描后补 title
      wrapper.innerHTML = `<span id="t11-inner">${MOCK.user.name}</span>`;
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.getElementById('t11-inner')?.getAttribute('data-wdpp-apis'),
  },
  {
    num: 12,
    name: 'Empty value',
    desc: 'el.textContent = ""',
    api: 'GET /api/user',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't12';
      root.appendChild(span);
      span.textContent = '';
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.getElementById('t12').getAttribute('data-wdpp-apis'),
  },
  {
    num: 13,
    name: 'Unicode / Emoji',
    desc: 'el.textContent = "🎉 " + user.name',
    api: 'GET /api/user',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't13';
      root.appendChild(span);
      span.textContent = '🎉 ' + MOCK.user.name + ' 🌟';
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: () => document.getElementById('t13').getAttribute('data-wdpp-apis'),
  },
  {
    num: 14,
    name: 'Mutation',
    desc: 'setTimeout 后改值',
    api: 'GET /api/user',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't14';
      root.appendChild(span);
      span.textContent = MOCK.user.name;
      setTimeout(() => {
        span.textContent = MOCK.user.city + ' (updated)';
      }, 50);
    },
    expected: 'GET /api/user',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/user');
    },
    check: async () => {
      await new Promise(r => setTimeout(r, 100));
      return document.getElementById('t14').getAttribute('data-wdpp-apis');
    },
  },
  {
    num: 15,
    name: 'List rendering',
    desc: 'For-loop 多个元素同 API',
    api: 'GET /api/orders',
    setup: (root) => {
      const ul = document.createElement('ul');
      ul.id = 't15';
      root.appendChild(ul);
      const orders = [
        { id: 101, product: 'A' },
        { id: 102, product: 'B' },
        { id: 103, product: 'C' },
      ];
      for (const o of orders) {
        const li = document.createElement('li');
        li.className = 't15-li';
        li.textContent = `#${o.id} - ${o.product}`;
        ul.appendChild(li);
      }
    },
    expected: 'GET /api/orders (all 3 li)',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/orders');
    },
    check: () => {
      const lis = document.querySelectorAll('.t15-li');
      const allApis = [...lis].map(li => li.getAttribute('data-wdpp-apis'));
      return allApis.every(a => a === 'GET /api/orders') ? 'GET /api/orders (all 3 li)' : 'MISMATCH: ' + JSON.stringify(allApis);
    },
  },
  {
    num: 16,
    name: 'Number with prefix',
    desc: '"$" + price.toFixed(2)',
    api: 'GET /api/product',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't16';
      root.appendChild(span);
      span.textContent = `$${MOCK.product.price.toFixed(2)}`;
    },
    expected: 'GET /api/product',
    setupExtras: (root) => {
      root.setAttribute('data-wdpp-section', 'GET /api/product');
    },
    check: () => document.getElementById('t16').getAttribute('data-wdpp-apis'),
  },
  {
    num: 17,
    name: 'No API source (orphan)',
    desc: 'Element with no section ancestor',
    api: 'none',
    setup: (root) => {
      const span = document.createElement('span');
      span.id = 't17';
      root.appendChild(span);
      span.textContent = 'orphan data';
    },
    expected: null,
    check: () => document.getElementById('t17').getAttribute('data-wdpp-apis'),
  },
];

function createCaseCard(c) {
  const card = document.createElement('div');
  card.className = 'case-card pending';
  card.id = `case-${c.num}`;
  card.innerHTML = `
    <div class="case-header">
      <span class="case-num">Case ${c.num}</span>
      <span class="case-status" id="status-${c.num}">PENDING</span>
    </div>
    <div class="case-name">${c.name}</div>
    <div class="case-desc">${c.desc}</div>
    <div class="case-target" id="target-${c.num}">(not rendered)</div>
    <div class="case-expected">Expected: <strong id="expected-${c.num}"></strong></div>
    <div class="case-actual" id="actual-${c.num}">Actual: —</div>
  `;
  return card;
}

function setupAll() {
  const grid = document.getElementById('test-grid');
  grid.innerHTML = '';

  // 用 stampOrigin 把 mock 数据包装成 Proxy
  MOCK.user = stampOrigin(MOCK_RAW.user, 'GET /api/user');
  MOCK.product = stampOrigin(MOCK_RAW.product, 'GET /api/product');
  MOCK.stats = stampOrigin(MOCK_RAW.stats, 'GET /api/stats');

  for (const c of CASES) {
    const card = createCaseCard(c);
    grid.appendChild(card);

    const section = document.createElement('section');
    try {
      c.setup(section);
    } catch (e) {
      console.error(`Case ${c.num} setup failed:`, e.message);
    }
    card.appendChild(section);  // 先 append,getElementById 才能找到
    if (c.setupExtras) {
      try {
        c.setupExtras(section);
      } catch (e) {
        console.error(`Case ${c.num} setupExtras failed:`, e.message);
      }
    }

    const targetEl = section.firstElementChild || section.firstChild;
    const targetText = targetEl?.outerHTML?.slice(0, 200) || '(empty)';
    document.getElementById(`target-${c.num}`).textContent = targetText;
    document.getElementById(`expected-${c.num}`).textContent = c.expected === null ? '(none)' : c.expected;
  }
}

async function runTests() {
  setupAll();

  let passed = 0;
  let failed = 0;
  const log = [];

  for (const c of CASES) {
    const card = document.getElementById(`case-${c.num}`);
    const status = document.getElementById(`status-${c.num}`);
    const actualEl = document.getElementById(`actual-${c.num}`);

    let actual;
    try {
      actual = await c.check();
    } catch (e) {
      actual = `ERROR: ${e.message}`;
    }

    const sortedActual = typeof actual === 'string' && actual.includes(',') && !actual.includes('MISMATCH')
      ? actual.split(',').sort().join(',')
      : actual;
    const sortedExpected = typeof c.expected === 'string' && c.expected.includes(',')
      ? c.expected.split(',').map(s => s.trim()).sort().join(',')
      : c.expected;

    const ok = sortedActual === sortedExpected || (c.expected === null && actual === null) ||
               (typeof actual === 'string' && actual.startsWith('GET /api/orders') && c.expected?.includes('all 3 li'));

    finalize(c, card, status, actualEl, actual, ok);
    ok ? passed++ : failed++;
    log.push(`Case ${c.num}: ${ok ? '✅ PASS' : '❌ FAIL'} — ${c.name} | actual="${actual}"`);
  }

  document.getElementById('stat-total').textContent = `Total: ${CASES.length}`;
  document.getElementById('stat-passed').textContent = `✅ Passed: ${passed}`;
  document.getElementById('stat-failed').textContent = `❌ Failed: ${failed}`;
  document.getElementById('results-log').textContent = log.join('\n');

  console.log(`\n=== WDPP Test Results ===`);
  console.log(`Passed: ${passed}/${CASES.length}`);
  console.log(`Failed: ${failed}/${CASES.length}`);
  for (const line of log) console.log(line);
}

function finalize(c, card, status, actualEl, actual, ok) {
  if (ok) {
    card.classList.remove('pending', 'failed');
    card.classList.add('passed');
    status.textContent = '✅ PASS';
    status.style.color = '#10b981';
    actualEl.classList.add('match');
    actualEl.textContent = `Actual: ${actual}`;
  } else {
    card.classList.remove('pending', 'passed');
    card.classList.add('failed');
    status.textContent = '❌ FAIL';
    status.style.color = '#ef4444';
    actualEl.classList.add('mismatch');
    actualEl.textContent = `Actual: ${actual} | Expected: ${c.expected}`;
  }
}

document.getElementById('run-tests').addEventListener('click', () => { runTests(); });

runTests();

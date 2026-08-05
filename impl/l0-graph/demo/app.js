// app.js — Demo 应用:真实 fetch + Universal Taint Union + title 属性显示
// 所有数据通过真实 fetch() 加载,WDPP 自动拦截盖戳

import { install } from '../src/index.js';
import {
  __recover, __passthrough, __aggr, __readProp,
  __controlAnd, __controlTernary, __writeField, __readSlot, __nullish,
} from '../src/babel-runtime.js';

// 1. 安装 WDPP(必须在 fetch 之前)
const wdpp = install({ expose: true });
console.log('[WDPP] installed');

// 2. App 状态(模块级)
let appState = {
  user: null,
  orders: [],
  products: [],
  stats: null,
  status: 'idle',
};

// 3. 真实 fetch(WDPP 已 shim,自动盖戳)
async function api(method, path) {
  const res = await fetch(path, { method });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

// 4. 数据加载
async function loadData() {
  try {
    // 三个 API 并发(演示并发盖戳)
    const [user, orders, products, stats] = await Promise.all([
      api('GET', '/api/user'),
      api('GET', '/api/orders'),
      api('GET', '/api/products'),
      api('GET', '/api/stats'),
    ]);
    appState.user = user;
    appState.orders = orders;
    appState.products = products;
    appState.stats = stats;

    // 字段突变测试:user.status = 'active'(演示 __writeField)
    __writeField(appState.user, 'currentStatus', 'active');

    render();
    updateStats();

    // 触发 hydration scan(更新所有 title)
    setTimeout(() => {
      wdpp.scanHydration();
      updateStats();
    }, 100);
  } catch (e) {
    console.error('[Demo] load failed:', e);
  }
}

// 5. 渲染:User Profile
function renderUserProfile() {
  const user = appState.user;
  if (!user) return;

  // 每个字段读取都触发 __readProp(若 babel 编译)
  // 这里手动调 __readSlot 模拟
  const nameEl = document.getElementById('user-name');
  nameEl.textContent = __readSlot(user, 'name');

  const emailEl = document.getElementById('user-email');
  emailEl.textContent = __readSlot(user, 'email');

  const cityEl = document.getElementById('user-city');
  cityEl.textContent = __readSlot(user, 'city');

  const memberEl = document.getElementById('user-member');
  memberEl.textContent = `Member since ${__readSlot(user, 'memberSince')}`;
}

// 6. 渲染:Orders(列表 + 字段访问)
function renderOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = '';

  for (const order of appState.orders) {
    const li = document.createElement('li');
    const id = __readSlot(order, 'id');
    const product = __readSlot(order, 'product');
    const price = __readSlot(order, 'price');
    const status = __readSlot(order, 'status');
    li.textContent = `#${id} - ${product} - $${price} - ${status}`;
    list.appendChild(li);
  }
}

// 7. 渲染:Conditional(控制流 taint)
function renderConditional() {
  const user = appState.user;
  if (!user) return;

  const vipSection = document.getElementById('vip-section');
  const regularSection = document.getElementById('regular-section');

  // __controlAnd(cond, condPassport, () => ...)
  const isVIP = __readSlot(user, 'isVIP');
  if (isVIP) {
    vipSection.style.display = 'block';
    regularSection.style.display = 'none';
    const discountEl = document.getElementById('vip-discount');
    discountEl.textContent = '20% off VIP orders';
  } else {
    vipSection.style.display = 'none';
    regularSection.style.display = 'block';
  }
}

// 8. 渲染:Field Mutation
function renderStatus() {
  const display = document.getElementById('status-display');
  display.textContent = appState.status;
}

// 9. 渲染:Aggregation(运算 union)
function renderAggregation() {
  // 累加 total(每次 + 都触发 __recover,result 继承 inputs union)
  let totalPrice = 0;
  for (const order of appState.orders) {
    const price = __readSlot(order, 'price');
    totalPrice = __recover(totalPrice + price, [totalPrice, price]);
  }
  document.getElementById('total-price').textContent = `$${totalPrice.toFixed(2)}`;

  // 累加 qty
  let totalQty = 0;
  for (const order of appState.orders) {
    const qty = __readSlot(order, 'qty');
    totalQty = __recover(totalQty + qty, [totalQty, qty]);
  }
  document.getElementById('item-count').textContent = `${totalQty} items`;

  // 显示 stats
  if (appState.stats) {
    const revenueEl = document.getElementById('stats-revenue');
    revenueEl.textContent = `$${__readSlot(appState.stats, 'revenue').toLocaleString()}`;
    const usersEl = document.getElementById('stats-users');
    usersEl.textContent = __readSlot(appState.stats, 'totalUsers').toLocaleString();
  }
}

// 10. 渲染:Products(列表渲染)
function renderProducts() {
  const list = document.getElementById('products-list');
  list.innerHTML = '';

  for (const p of appState.products) {
    const li = document.createElement('li');
    li.className = 'product-item';
    const name = __readSlot(p, 'name');
    const price = __readSlot(p, 'price');
    const stock = __readSlot(p, 'stock');
    li.textContent = `${name} - $${price} (${stock} in stock)`;
    list.appendChild(li);
  }
}

function render() {
  renderUserProfile();
  renderOrders();
  renderConditional();
  renderStatus();
  renderAggregation();
  renderProducts();
}

// 11. Update Status(测试字段突变)
document.getElementById('update-btn').addEventListener('click', () => {
  const newStatus = appState.status === 'idle' ? 'active' : 'idle';
  // __writeField:appState.status = newStatus + 字段 taint 传播
  __writeField(appState, 'status', newStatus);
  appState.status = newStatus;

  renderStatus();
  updateStats();

  // 立即重新 scan(让 status 元素的 title 更新)
  wdpp.scanHydration();
});

// 12. 统计
function updateStats() {
  const allEdges = wdpp.graph.allEdges();
  const allNodes = wdpp.graph.allNodes();
  const apiNodes = allNodes.filter(n => n.type === 'ApiSource');

  document.getElementById('stat-apis').textContent = `📡 APIs: ${apiNodes.length}`;
  document.getElementById('stat-nodes').textContent = `🔵 Nodes: ${allNodes.length}`;
  document.getElementById('stat-edges').textContent = `↔️ Edges: ${allEdges.length}`;

  // DevTools panel
  const dt = document.getElementById('devtools-content');
  dt.innerHTML = `
    <p><strong>API Sources:</strong> ${apiNodes.map(n => n.id.replace('api:', '')).join(' | ')}</p>
    <p><strong>Total Operations:</strong> ${allNodes.filter(n => n.type === 'Operation').length}</p>
    <p><strong>Fields tracked:</strong> ${allNodes.filter(n => n.type === 'Field').length}</p>
    <p><strong>DOM Nodes tracked:</strong> ${allNodes.filter(n => n.type === 'DomNode').length}</p>
    <p><strong>Total Edges:</strong> ${allEdges.length}</p>
    <p style="margin-top:8px;color:#888">Hover any element with 📡 icon to see its APIs in tooltip.</p>
  `;
}

// 13. 点击 DOM 显示 provenance(可选 debug)
document.addEventListener('click', (e) => {
  const target = e.target;
  if (!target || target.tagName === 'BUTTON') return;

  const apis = target.getAttribute?.('data-wdpp-apis');
  if (apis) {
    console.log('[WDPP] Element provenance:', {
      element: target.tagName,
      text: target.textContent?.slice(0, 50),
      apis: apis.split(','),
    });
  }
});

// 启动
loadData();

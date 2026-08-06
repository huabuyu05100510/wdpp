// app.js — 简化版:API 级块级归因
// 不再用 __readSlot / __recover,只渲染 + section wrapper 标 API

import { install } from '../src/index.js';

const wdpp = install({ expose: true });
console.log('[WDPP] installed');

// App 状态
let appState = {
  user: null,
  orders: [],
  products: [],
  stats: null,
  status: 'idle',
  lastUpdateApi: null,
};

// 真实 fetch(WDPP shim 自动盖戳 + 建 ApiSource 节点)
async function api(method, path) {
  const res = await fetch(path, { method });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

async function loadData() {
  try {
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

    render();
    updateStats();

    // Hydration 扫描:给所有带 data-wdpp-section 的 section 后代补 title
    setTimeout(() => wdpp.scanHydration(), 100);
  } catch (e) {
    console.error('[Demo] load failed:', e);
  }
}

// 渲染:User Profile
function renderUserProfile() {
  const u = appState.user;
  document.getElementById('user-name').textContent = u.name;
  document.getElementById('user-email').textContent = u.email;
  document.getElementById('user-city').textContent = u.city;
  document.getElementById('user-member').textContent = `Member since ${u.memberSince}`;
}

// 渲染:Orders
function renderOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = '';
  for (const o of appState.orders) {
    const li = document.createElement('li');
    li.className = 'order-item';
    // 字符串拼接不再丢 taint(因为父 section 标了 API)
    li.textContent = `#${o.id} - ${o.product} - $${o.price} - ${o.status}`;
    list.appendChild(li);
  }
}

// 渲染:Conditional
function renderConditional() {
  const u = appState.user;
  const vipSection = document.getElementById('vip-section');
  const regularSection = document.getElementById('regular-section');
  if (u.isVIP) {
    vipSection.style.display = 'block';
    regularSection.style.display = 'none';
    document.getElementById('vip-discount').textContent = `20% off VIP orders`;
  } else {
    vipSection.style.display = 'none';
    regularSection.style.display = 'block';
  }
}

// 渲染:Status
function renderStatus() {
  document.getElementById('status-display').textContent = appState.status;
  document.getElementById('last-update-api').textContent = appState.lastUpdateApi || '—';
}

// 渲染:Aggregation
function renderAggregation() {
  // 字符串拼接 + 数字运算 - 都自动带 API(父 section 标了)
  let totalPrice = 0;
  let totalQty = 0;
  for (const o of appState.orders) {
    totalPrice = totalPrice + o.price;
    totalQty = totalQty + o.qty;
  }
  document.getElementById('total-price').textContent = `$${totalPrice.toFixed(2)}`;
  document.getElementById('item-count').textContent = `${totalQty} items`;
  document.getElementById('agg-status').textContent = `computed from ${appState.orders.length} orders`;
}

// 渲染:Products
function renderProducts() {
  const list = document.getElementById('products-list');
  list.innerHTML = '';
  for (const p of appState.products) {
    const li = document.createElement('li');
    li.className = 'product-item';
    li.textContent = `${p.name} - $${p.price} (${p.stock} in stock)`;
    list.appendChild(li);
  }
}

// 渲染:Dashboard Stats
function renderDashboardStats() {
  const s = appState.stats;
  document.getElementById('stats-users').textContent = s.totalUsers.toLocaleString();
  document.getElementById('stats-revenue').textContent = `$${s.revenue.toLocaleString()}`;
  document.getElementById('stats-orders').textContent = s.totalOrders.toLocaleString();
}

function render() {
  renderUserProfile();
  renderOrders();
  renderConditional();
  renderStatus();
  renderAggregation();
  renderProducts();
  renderDashboardStats();
}

// Update Status:模拟客户端 mutation(没有任何 API 来源)
document.getElementById('update-btn').addEventListener('click', () => {
  appState.status = appState.status === 'idle' ? 'active' : 'idle';
  // 注意:这次写入没 API 来源(section 标的是 /api/stats)
  // 但因为 status-display 在 stats section 里,会显示 GET /api/stats
  renderStatus();
  // 立即重新 scan
  wdpp.scanHydration();
  updateStats();
});

function updateStats() {
  const allEdges = wdpp.graph.allEdges();
  const allNodes = wdpp.graph.allNodes();
  const apiNodes = allNodes.filter(n => n.type === 'ApiSource');

  document.getElementById('stat-apis').textContent = `📡 APIs: ${apiNodes.length}`;
  document.getElementById('stat-nodes').textContent = `🔵 Nodes: ${allNodes.length}`;
  document.getElementById('stat-edges').textContent = `↔️ Edges: ${allEdges.length}`;

  const dt = document.getElementById('devtools-content');
  dt.innerHTML = `
    <strong>API Sources:</strong> ${apiNodes.map(n => n.id.replace('api:', '')).join(' | ')}<br>
    <strong>Operations:</strong> ${allNodes.filter(n => n.type === 'Operation').length} |
    <strong>Fields:</strong> ${allNodes.filter(n => n.type === 'Field').length} |
    <strong>DOM Nodes:</strong> ${allNodes.filter(n => n.type === 'DomNode').length} |
    <strong>Total Edges:</strong> ${allEdges.length}
  `;
}

loadData();

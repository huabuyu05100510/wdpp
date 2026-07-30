// demo.js - 端到端演示:fetch -> 渲染 -> 可视化 DevTools 点选反查
import { install } from '../src/index.js';
import { stampOrigin } from '../src/stamp-origin.js';
import { __recover, __controlAnd, __readSlot } from '../src/babel-runtime.js';
import { enableDevTools } from '../src/devtools.js';

install({ expose: true });

// mock fetch
globalThis.fetch = async (url) => {
  const data = {
    user: { name: 'Ada Lovelace', level: 42, isVip: true, avatar: 'ada.png', bio: 'First programmer' },
    posts: [
      { id: 'p1', title: 'Analytical Engine Notes', views: 1337 },
      { id: 'p2', title: 'On Computing Machinery', views: 42 },
    ],
  };
  return {
    json: async () => { stampOrigin(data, `GET ${url.split('?')[0]}`); return data; },
    clone() { return this; },
  };
};

async function render() {
  const res = await fetch('/api/profile');
  const data = await res.json();
  const app = document.getElementById('app');

  app.innerHTML = `
    <div class="card">
      <div class="profile">
        <img id="avatar" />
        <div class="info">
          <h3 id="name"></h3>
          <div>Level: <span class="level" id="level"></span></div>
          <div id="vip-slot"></div>
          <div id="bio" style="color:#666;font-size:13px"></div>
        </div>
      </div>
      <ul id="posts"></ul>
      <footer>© 2026 固定版权字面量(不应有边)</footer>
    </div>
  `;

  // 数据边
  document.getElementById('name').textContent = data.user.name;
  document.getElementById('avatar').src = data.user.avatar;
  document.getElementById('bio').textContent = data.user.bio;

  // 相邻文本:LV.{level}
  const lvl = document.getElementById('level');
  lvl.appendChild(document.createTextNode('LV.'));
  lvl.appendChild(document.createTextNode(data.user.level));

  // 控制边:isVip && VIP badge
  const vipSlot = document.getElementById('vip-slot');
  if (data.user.isVip) {
    const badge = document.createElement('span');
    badge.className = 'vip';
    badge.textContent = __controlAnd(data.user.isVip, __readSlot(data, ['user', 'isVip']), () => 'VIP');
    vipSlot.appendChild(badge);
  }

  // 列表
  const ul = document.getElementById('posts');
  for (const p of data.posts) {
    const li = document.createElement('li');
    li.textContent = `${p.title} (${p.views} views)`;
    ul.appendChild(li);
  }

  // 变换(L1):posts[0].title.toUpperCase
  const li0 = ul.children[0];
  li0.textContent = __recover(data.posts[0].title.toUpperCase(), [data.posts[0].title]);

  // 启用可视化 DevTools
  enableDevTools();
}

render();

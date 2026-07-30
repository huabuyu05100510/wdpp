// main.tsx — WDPP 注入 + React Router + 多页面
import { install, stampOrigin } from '../../src/index.js'
import { getStamp, expandBits, fieldIdToPath } from '../../src/value-index.js'
import { recordEdge, clearEdges, lookup, allEdges } from '../../src/graph.js'

// WDPP 启动:拦 fetch/XHR,DOM 收口,opt-in
install({ expose: true })

// ====== WDPP MutationObserver 扫描(不依赖 patchSetter,最可靠的 DOM 收口) ======
function scanNode(node: Node) {
  if (node.nodeType === 3) {
    const v = (node.nodeValue || '').trim()
    if (!v) return
    const s = getStamp(v)
    if (s) {
      clearEdges(node)
      const conf = s.collision ? 'collision' : s.count > 1 ? 'value-match' : 'exact'
      for (const id of expandBits(s.passport)) recordEdge(id, node, 'data', conf)
    }
  } else if (node.nodeType === 1) {
    const el = node as Element
    for (const attr of el.attributes || []) {
      const s = getStamp(attr.value)
      if (s) {
        clearEdges(el)
        const conf = s.collision ? 'collision' : s.count > 1 ? 'value-match' : 'exact'
        for (const id of expandBits(s.passport)) recordEdge(id, el, 'data', conf, attr.name)
      }
    }
    for (const child of el.childNodes) scanNode(child)
  }
}

function startScan() {
  scanNode(document.body)
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) scanNode(n)
  }).observe(document.body, { childList: true, subtree: true })
}

// 点击反查弹窗
function onClick(e: Event) {
  const target = e.target as HTMLElement
  let edges: any[] = []
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const e2 = lookup(walker.currentNode)
    if (e2.length) { edges = e2.map(r => ({ ...r, fieldPath: fieldIdToPath(r.fieldId) })); break }
  }
  if (!edges.length) {
    const e3 = lookup(target)
    if (e3.length) edges = e3.map(r => ({ ...r, fieldPath: fieldIdToPath(r.fieldId) }))
  }
  if (!edges.length) return
  e.stopPropagation(); e.preventDefault()
  const existing = document.getElementById('__wdpp_overlay')
  if (existing) existing.remove()
  const overlay = document.createElement('div')
  overlay.id = '__wdpp_overlay'
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center'
  overlay.onclick = () => overlay.remove()
  const modal = document.createElement('div')
  modal.style.cssText = 'background:#fff;border-radius:12px;padding:24px;width:480px;max-width:90vw;font-family:system-ui;box-shadow:0 8px 32px rgba(0,0,0,.2)'
  modal.onclick = ev => ev.stopPropagation()
  modal.innerHTML = `<div style="font-size:16px;font-weight:700;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
    <span>🔗 Data Provenance</span><span style="cursor:pointer;color:#999;font-size:20px" id="__wdpp_x">✕</span></div>`
  for (const e2 of edges) {
    const c = e2.confidence === 'exact' ? '#52c41a' : '#faad14'
    const item = document.createElement('div')
    item.style.cssText = `background:#f6f8fa;border-radius:8px;padding:14px;margin-bottom:8px;font-family:monospace;font-size:13px;border-left:3px solid ${c}`
    item.innerHTML = `<div style="font-weight:700;word-break:break-all">${e2.fieldPath || '(unknown)'}</div>
      <div style="margin-top:6px"><span style="background:${c}20;color:${c};padding:2px 8px;border-radius:4px;font-size:11px">${e2.confidence}</span>
      <span style="color:#999;margin-left:8px">${e2.edgeType}${e2.attr ? ' · ' + e2.attr : ''}</span></div>`
    modal.appendChild(item)
  }
  overlay.appendChild(modal)
  document.body.appendChild(overlay)
  document.getElementById('__wdpp_x')!.onclick = () => overlay.remove()
}

// 延迟启动扫描 + 点击监听
setTimeout(() => {
  startScan()
  document.addEventListener('click', onClick, true)
  setInterval(() => scanNode(document.body), 2000) // 定期重扫
  console.log('[WDPP] scan started')
}, 3000)

// ====== React App ======
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Link, useParams, useNavigate } from 'react-router-dom'

const API = 'https://jsonplaceholder.typicode.com'

// ===== 页面:用户列表 =====
function UsersPage() {
  const [users, setUsers] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [search, setSearch] = React.useState('')

  React.useEffect(() => {
    fetch(`${API}/users`).then(r => r.json()).then(d => { setUsers(d); setLoading(false) })
  }, [])

  const filtered = users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <h2>Users <small style={{color:'#999',fontSize:14}}>({filtered.length} results from {API}/users)</small></h2>
      <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)}
        style={{padding:'8px 12px',borderRadius:6,border:'1px solid #ddd',width:300,marginBottom:16}} />
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:14}}>
        <thead><tr style={{background:'#f5f5f5'}}>
          {['ID','Name','Email','Phone','Company','City','Website'].map(h =>
            <th key={h} style={{padding:'10px 12px',textAlign:'left',fontWeight:600}}>{h}</th>)}
        </tr></thead>
        <tbody>
          {filtered.map(u => (
            <tr key={u.id} style={{borderBottom:'1px solid #eee'}}>
              <td style={{padding:'10px 12px',color:'#1677ff',fontWeight:700}}>{u.id}</td>
              <td style={{padding:'10px 12px'}}>
                <Link to={`/users/${u.id}`} style={{color:'#333',fontWeight:500}}>{u.name}</Link>
              </td>
              <td style={{padding:'10px 12px',color:'#666'}}>{u.email}</td>
              <td style={{padding:'10px 12px',color:'#666'}}>{u.phone}</td>
              <td style={{padding:'10px 12px'}}>{u.company?.name}</td>
              <td style={{padding:'10px 12px',color:'#666'}}>{u.address?.city}</td>
              <td style={{padding:'10px 12px'}}>
                <a href={`http://${u.website}`} target="_blank" style={{color:'#1677ff'}}>{u.website}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ===== 页面:用户详情(嵌套数据 + 条件渲染) =====
function UserDetailPage() {
  const { id } = useParams()
  const [user, setUser] = React.useState<any>(null)
  const [posts, setPosts] = React.useState<any[]>([])
  const [albums, setAlbums] = React.useState<any[]>([])

  React.useEffect(() => {
    fetch(`${API}/users/${id}`).then(r => r.json()).then(setUser)
    fetch(`${API}/users/${id}/posts`).then(r => r.json()).then(setPosts)
    fetch(`${API}/users/${id}/albums`).then(r => r.json()).then(setAlbums)
  }, [id])

  if (!user) return <div style={{padding:40,textAlign:'center'}}>⏳ Loading...</div>

  return (
    <div>
      <Link to="/" style={{color:'#1677ff'}}>← Back to Users</Link>
      <h2>{user.name}</h2>
      <div style={{display:'flex',gap:24,marginTop:16}}>
        <div style={{flex:1}}>
          <h3>Contact</h3>
          <dl style={{fontSize:14}}>
            <dt style={{fontWeight:600}}>Email</dt><dd style={{marginLeft:0,marginBottom:8}}>{user.email}</dd>
            <dt style={{fontWeight:600}}>Phone</dt><dd style={{marginLeft:0,marginBottom:8}}>{user.phone}</dd>
            <dt style={{fontWeight:600}}>Website</dt><dd style={{marginLeft:0,marginBottom:8}}>
              <a href={`http://${user.website}`} style={{color:'#1677ff'}}>{user.website}</a></dd>
            <dt style={{fontWeight:600}}>Company</dt><dd style={{marginLeft:0,marginBottom:8}}>
              {user.company?.name} — <em>{user.company?.catchPhrase}</em></dd>
            <dt style={{fontWeight:600}}>Address</dt><dd style={{marginLeft:0,marginBottom:8}}>
              {user.address?.street}, {user.address?.city} ({user.address?.zipcode})</dd>
          </dl>
        </div>
        <div style={{flex:1}}>
          <h3>Recent Posts ({posts.length})</h3>
          {posts.slice(0, 3).map(p => (
            <div key={p.id} style={{padding:'8px 0',borderBottom:'1px solid #eee'}}>
              <Link to={`/posts/${p.id}`} style={{fontWeight:600,color:'#333'}}>{p.title}</Link>
              <p style={{fontSize:13,color:'#666'}}>{p.body.slice(0, 100)}...</p>
            </div>
          ))}
          <h3 style={{marginTop:16}}>Photo Albums ({albums.length})</h3>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {albums.slice(0, 4).map(a => (
              <Link key={a.id} to={`/albums/${a.id}`} style={{padding:'4px 12px',background:'#f0f0f0',borderRadius:6,fontSize:13}}>
                {a.title.slice(0, 20)}...
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ===== 页面:帖子详情(条件渲染) =====
function PostDetailPage() {
  const { id } = useParams()
  const [post, setPost] = React.useState<any>(null)
  const [comments, setComments] = React.useState<any[]>([])

  React.useEffect(() => {
    fetch(`${API}/posts/${id}`).then(r => r.json()).then(setPost)
    fetch(`${API}/posts/${id}/comments`).then(r => r.json()).then(setComments)
  }, [id])

  if (!post) return <div style={{padding:40}}>⏳</div>

  return (
    <div>
      <Link to="/" style={{color:'#1677ff'}}>← Back</Link>
      <h2>{post.title}</h2>
      <p style={{fontSize:15,lineHeight:1.6}}>{post.body}</p>
      <h3>Comments ({comments.length})</h3>
      {comments.map(c => (
        <div key={c.id} style={{background:'#f9f9f9',padding:12,borderRadius:8,marginBottom:8}}>
          <strong>{c.name}</strong> <span style={{color:'#999',fontSize:13}}>— {c.email}</span>
          <p style={{fontSize:14,marginTop:4}}>{c.body}</p>
        </div>
      ))}
      {comments.length === 0 && <p style={{color:'#999'}}>No comments yet.</p>}
    </div>
  )
}

// ===== 页面:相册(图片属性) =====
function AlbumPage() {
  const { id } = useParams()
  const [photos, setPhotos] = React.useState<any[]>([])

  React.useEffect(() => {
    fetch(`${API}/albums/${id}/photos`).then(r => r.json()).then(setPhotos)
  }, [id])

  return (
    <div>
      <Link to="/" style={{color:'#1677ff'}}>← Back</Link>
      <h2>Album Photos ({photos.length})</h2>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:12}}>
        {photos.slice(0, 20).map(p => (
          <div key={p.id} style={{textAlign:'center'}}>
            <img src={p.thumbnailUrl} alt={p.title} style={{width:150,height:150,borderRadius:8}} />
            <p style={{fontSize:11,color:'#666',marginTop:4}}>{p.title.slice(0, 30)}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== 页面:仪表盘(统计卡片 + 条件) =====
function DashboardPage() {
  const [stats, setStats] = React.useState<any>(null)

  React.useEffect(() => {
    Promise.all([
      fetch(`${API}/users`).then(r => r.json()),
      fetch(`${API}/posts`).then(r => r.json()),
      fetch(`${API}/photos`).then(r => r.json()),
    ]).then(([users, posts, photos]) => {
      setStats({ users: users.length, posts: posts.length, photos: photos.length })
    })
  }, [])

  if (!stats) return <div style={{padding:40}}>⏳</div>

  return (
    <div>
      <h2>Dashboard</h2>
      <div style={{display:'flex',gap:16,marginTop:16}}>
        {[
          { label: 'Total Users', value: stats.users, color: '#1677ff', icon: '👥' },
          { label: 'Total Posts', value: stats.posts, color: '#52c41a', icon: '📝' },
          { label: 'Total Photos', value: stats.photos, color: '#722ed1', icon: '📸' },
        ].map((s, i) => (
          <div key={i} style={{flex:1,background:'#fff',borderRadius:8,padding:20,boxShadow:'0 1px 3px rgba(0,0,0,.1)'}}>
            <div style={{fontSize:13,color:'#888'}}>{s.icon} {s.label}</div>
            <div style={{fontSize:28,fontWeight:700,color:s.color,marginTop:8}}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== App ======
function App() {
  return (
    <BrowserRouter>
      <div style={{fontFamily:'-apple-system,sans-serif',margin:0,minHeight:'100vh',background:'#f5f5f5'}}>
        {/* 导航 */}
        <nav style={{background:'#1a1a2e',padding:'12px 24px',display:'flex',gap:24,alignItems:'center'}}>
          <span style={{color:'#fff',fontWeight:700,fontSize:18}}>🌐 WDPP</span>
          <Link to="/" style={{color:'#ffffff80',textDecoration:'none',fontSize:14}}>Dashboard</Link>
          <Link to="/users" style={{color:'#fff',textDecoration:'none',fontSize:14}}>Users</Link>
        </nav>

        {/* 提示条 */}
        <div style={{background:'#e8f4fd',padding:'8px 24px',fontSize:13,color:'#1677ff'}}>
          👆 Click any data value to see which API field it came from · Open Network tab to see real requests
        </div>

        {/* 内容 */}
        <div style={{maxWidth:1100,margin:'0 auto',padding:24}}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/:id" element={<UserDetailPage />} />
            <Route path="/posts/:id" element={<PostDetailPage />} />
            <Route path="/albums/:id" element={<AlbumPage />} />
          </Routes>
        </div>

        {/* 底栏 */}
        <div style={{position:'fixed',bottom:0,left:0,right:0,background:'#1a1a2e',color:'#fff',padding:'8px 24px',fontSize:12,display:'flex',justifyContent:'space-between'}}>
          <span id="__wdpp_count">WDPP: loading...</span>
          <span style={{color:'#ffffff50'}}>Source: jsonplaceholder.typicode.com</span>
        </div>
      </div>
    </BrowserRouter>
  )
}

// 更新底栏边数
setInterval(() => {
  const el = document.getElementById('__wdpp_count')
  if (el) {
    const n = allEdges().length
    el.textContent = `WDPP: ${n} edges tracked`
  }
}, 2000)

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)

# WDPP 参考实现(L0 + L1)

按值追踪的零插桩基线(L0)+ 变换插桩与控制边(L1)。纯 ESM JavaScript。
对应规范:《Web数据血缘-最优设计与规范提案》§4.6。

## 测试(32 全过)

```bash
cd impl/l0
node --test test/conformance.js test/l1.conformance.js test/dom.conformance.js test/p0-fixes.js
```

- `conformance.js`(12):L0 值索引/盖戳--类型归一化、低熵黑名单、field-sensitive、碰撞并集、熔断、代际、路径分段、循环引用
- `l1.conformance.js`(6):L1 变换恢复 + 控制边--toUpperCase/toFixed 出边、&&/三元控制边、语义保持、跨组件降级
- `dom.conformance.js`(9):jsdom DOM sink--textContent/nodeValue/createTextNode/setAttribute/property/拼接/字面量反例/field-sensitive/MutationObserver 清理
- `p0-fixes.js`(5):compaction 物理删过期代 + stampOriginChunked 分片不阻塞

## benchmark(go/no-go 实测数据)

```bash
node bench/bench-overhead.js   # 开销:L0 DOM写 26-195ns / L1 变换 +250ns / 大响应盖戳分片
node bench/bench-recall.js     # 召回:L0 60% / L1 100%(合成)/ 反例 5/5
node bench/bench-memory.js     # 内存:fieldRegistry 6 字段(有界)/ entries bumpGen 后 0(compaction)
```

实测对照规范宣称:L0≈1.05×(PASS,亚μs/DOM写)、L1~3×(PASS,+250ns/变换)、召回 60%/90%(PASS,L0 实测 60%)。

## demo

```bash
# L0 vanilla demo
cd impl/l0 && npx serve .   # 开 http://localhost:3000/demo/

# L0+L1 React demo
cd impl/l0/demo-react && npm install && npx vite dev
```

React demo 用 Vite 插件把 L1 Babel 插件接入 app 代码,验证真实 React 数据流(数据边 + 变换 + 内联控制边)。

## 结构

```
src/
  value-index.js   值映射 + 字段ID + 低熵黑名单 + 熔断 + 代际
  stamp-origin.js  fetch/XHR 拦截 + 递归盖戳(后序并集/循环/路径分段/length/GraphQL)+ 双写 SM
  sm.js            Shadow Memory(条件槽位侧车:字段级护照)
  control-index.js controlIndex 桥(控制边按值归因,带代际)
  recovery.js      不透明函数四档恢复(身份/值指纹/并集/CUT)+ 纯方法白名单
  dom-sink.js      DOM 拦截(nodeValue 主通道 + setAttribute + property 表)+ 拼接 + MutationObserver
  babel-runtime.js L1 helper:__recover/__controlAnd/__controlTernary/__readSlot
  graph.js         边存储 + 双向索引(点选 O(1))
  index.js         install() + opt-in __wdpp__
babel/plugin.js    L1 Babel 插件:纯方法并集 + 条件表达式 controlIndex 登记
demo/              L0 vanilla 可演示页
demo-react/        L0+L1 React+Vite 集成
test/              conformance + l1 + dom(jsdom)
```

## 能力与边界(诚实,实测验证)

| | L0 | L1 |
|---|---|---|
| 字符串数据边 | ✅ 高精度 | ✅ |
| 变换值(toUpperCase/toFixed) | ❌ | ✅ 四档恢复 |
| 类型归一化(7 vs "7") | ✅ | ✅ |
| 碰撞并集 + 熔断 | ✅ 诚实标 collision | ✅ |
| 代际回收 | ✅ | ✅ |
| 内联控制边(`{cond && "VIP"}`) | ❌ | ✅ controlIndex |
| 跨组件控制边(`{cond && <Panel/>}`) | ❌ | ❌ 降级 L2 |
| field-sensitive | ✅ 自动 | ✅ |

## 实测确认的关键设计点

- **按值追踪够用**:一个 `Map<原始值, {passport, gen}>` + 并集 + 查询,端到端跑通 27 测试 + React demo
- **field-sensitive 自动**:不同值天然分开,无需按属性槽影子内存
- **碰撞诚实**:并集标 collision 不 CUT,`price*qty=14` 撞 `shippingCost=14` 不丢真实流
- **控制边侧车**:条件槽位(SM 字段级)+ controlIndex(按值归因)让内联控制边闭环;跨组件诚实降级 L2
- **框架无关**:L0 只拦 fetch/DOM,React/Vue/Svelte 通用(React demo 验证)


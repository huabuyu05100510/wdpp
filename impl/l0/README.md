# WDPP 参考实现(L0 + L1)

按值追踪的零插桩基线(L0)+ 变换插桩与控制边(L1)。纯 ESM JavaScript。
对应规范:《Web数据血缘-最优设计与规范提案》§4.6。

## ⚠️ 勘误与诚实边界(2026-08,**优先于下文旧声明**;见 `评审报告-代表作可行性与全边界深探.md`)

**下文部分数字为早期合成/估算,与真实 app 实测不符,以本节为准:**
- **召回**:下文 "60%/90%" 是合成 bench 估算;**真实 app(ant-design-pro 规则表表体)L0 28.6% / L1 42.9%**(scanHydration 后)。status/updatedAt(valueEnum/dayjs)仍漏——变换在被排除的库内部。
- **测试数**:32 → **67**(加 xhr/protocol + jalangi 断路一致性 18/18)。
- **L2 全属性读插桩**:真实代码上**不稳/已否决**(`++`/方法 `this` 崩;整库插桩 prohibitive:6.4min build + 运行时崩)。下文能力表 L2 行仅历史参考。
- **精度边界(评审 §3 源码核验,均为真实限制)**:
  - 表格**行级身份**在 ingest 时被 `[]` 通配放弃(`stamp-origin.js` 数组 path 通配)→ 值索引通道只到**列级**,非行级;行级需 identity/Proxy 通道(未实证)。
  - 小整数/枚举码(2/3/7/200/status 码)碰撞率高 → field-level 可能退化到 response-level(碰撞率未实测)。
  - 聚合/不透明调用后 field 身份坍缩为"对象并集"(`recovery.js`/`__aggr`)。
  - `BREAKER_K=5` 把合法多源格(汇总/拼接)判 collision。
  - 代际 GC 可静默丢长寿命 state 的 provenance(触发频率未定,正确性↔内存旋钮)。
  - 大响应走 chunked,SM 并集残缺 → 控制边降级。
- **未测**:断路集插桩的真实 build/runtime 开销(Jalangi 类 ~28× 是文献值,本套未测)。
- **"黄金对"(运行时+静态)假设自相矛盾**:静态 producer 补库内变换,要么撞 ODGen 墙(分析库不可规模化)、要么是 per-library patch 复活;解法方向 = **框架插件契约(库声明映射)**,待 POC。

**真实贡献(立得住)**:断路子集(值附着扛纯流动,只插断路)+ PROV-DM 交换模型 + 6 原语本体 + 诚实。这是 dev 工具级运行时追踪 + 规范骨架;"接近完全覆盖真实 app"未证、"可负担"无开销背书。

---

## ✅ 声明通道:两个真实测试床 precision+recall 100%(2026-08-03 实测复现)

上面勘误记录的是**纯值索引通道**(L0/L1,无声明)的真实限制(antd 规则表 28.6/42.9)。在此基础上加了**静态声明通道**(声明为权威真相源,值索引只补 gap),在两个真实框架测试床上**实测 precision+recall 双 100%**(2026-08-03 实际复现):

- **机制**(两套对称,都"只填未绑定的 gap、不动已绑定格" → precision 全程 100%):
  - **antd 列声明**:`babel/static-plugin.js` 构建期提取 `columns.{dataIndex,valueType}` → runtime `dom-sink.js::bindTables` 用已绑定列校准列偏移,按位置补未绑定的变换列(`status` valueEnum / `updatedAt` dateTime——显示值不在响应里,值索引必然 miss)。
  - **rwa data-test 声明**:app wiring `registerDataTestSpec({prefix,tokenField})` + `dom-sink.js::bindDataTest` 扫 `[data-test]` 按 token 绑字段(补 `amount` formatAmount 变换 / count 低熵值)。
- **实测**(四态 harness:correct/wrong/missed/not-API;静态 UI 排除分母):
  - **antd** `/list/table-list` 规则表 `/api/rule`:**100% / 100%**(20 行 × 5 数据列 = 100 格,含 status/updatedAt 变换列;option 静态列 trueNegative=20 无误报)。
  - **rwa** `/` 交易流 `/transactions`:**100% / 100%**(10 渲染行 × 5 token = 50 格,含 `amount` `-$307.99` 变换;avatar/action skipped 排除)。
  - 跑法:`testbed-antd/verify/precision.mjs`、`testbed-rwa/verify/precision.mjs`。
- **诚实边界**:
  - 这是 **"API 派生声明格"** 上的 100%(antd 全声明、rwa data-test 声明),非任意 DOM 节点 100%。
  - rwa `sender`/`receiver` 报 `[receiverName,senderName]` **字段集合**(一人跨交易既作 sender 又作 receiver,值索引并集 sound)——不破 precision,但非单一。
  - rwa `avatar src` 已绑(属性通道 img.src,20/20,`[receiverAvatar,senderAvatar]` 集合 sound);`action` 列未绑(静态操作,skipped 排除);react-virtualized 只测实际渲染行(屏外排除)。
  - **纯值索引通道单独仍受限**(28.6/42.9,见上勘误):声明通道是它的**补全**,非替代。

---

## 测试(67 全过)

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

实测对照规范宣称:**合成 bench(非真实 app)** —— L0≈1.05×(亚μs/DOM写)、L1~3×(+250ns/变换)、召回 60%/90%(合成)。**真实 app(ant-design-pro 规则表)远低:L0 28.6% / L1 42.9%**,见顶部"勘误与诚实边界"。合成数仅作机制验证,不代表真实 app 召回。

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
babel/static-plugin.js M1 静态声明插件:提取 antd columns {dataIndex,valueType}
demo/              L0 vanilla 可演示页
demo-react/        L0+L1 React+Vite 集成
testbed-antd/      真实测试床 1:ant-design-pro(Umi+webpack)+ precision harness
testbed-rwa/       真实测试床 2:cypress-realworld-app(Vite+MUI)+ precision harness
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


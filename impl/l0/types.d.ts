// types.d.ts - WDPP 公共 API 类型(WDPP 协议 §4.1)
// 任何 WDPP 实现暴露此接口,跑 protocol.conformance.js 对齐。

/** 边类型 */
export type EdgeType = 'data' | 'control';

/** 置信度(WDPP §4.5) */
export type Confidence =
  | 'exact'        // 唯一值,精确
  | 'value-match'  // 值匹配(可能碰撞,1<count<=K)
  | 'approx'       // 并集兜底(可能过染)
  | 'collision'    // 熔断(count>K)
  | 'none';        // 查不到(断流)

/** 字段来源引用 */
export interface SourceRef {
  sourceId: string;       // canonical:原始 URL/method(query 丢弃)
  routeTemplate?: string; // 可选注解(如 GET /users/:id)
  fieldPath: string[];    // ["user","name"](分段,避免 "." 歧义)
}

/** 一条血缘记录 */
export interface ProvenanceRecord {
  fieldId: number;
  fieldPath: string | null;
  attr?: string;                 // 属性边时
  edgeType: EdgeType;
  confidence: Confidence;
  lastSeenWrite: number;         // 单调写序号
}

/** WDPP 运行时接口(opt-in 时挂 window.__wdpp__) */
export interface WebDataProvenance {
  /** 点选反查:DOM -> 字段列表 */
  lookup(node: Node): ProvenanceRecord[];
  /** 字段 -> DOM 列表(高亮路径) */
  queryField(fieldId: number): Array<{ node: Node; attr?: string; edgeType: EdgeType; confidence: Confidence }>;
  /** 全图 */
  allEdges(): Array<ProvenanceRecord & { node: Node }>;
  /** 登出/路由切换:使旧护照过期(代际回收) */
  clearProvenance(): void;
  /** 订阅(批量/节流) */
  subscribe(cb: (recs: ProvenanceRecord[]) => void): () => void;
  /** 当前代际 */
  getCurrentGen(): number;
  /** 字段总数 */
  fieldCount(): number;
}

/** L0/L1 一致性级别 */
export type ConformanceLevel = 'WDPP-L0' | 'WDPP-L1' | 'WDPP-L2';

/** install 选项 */
export interface InstallOptions {
  /** 是否挂 window.__wdpp__(opt-in,安全) */
  expose?: boolean;
}

/** 安装运行时(拦截 fetch/XHR/DOM) */
export function install(opts?: InstallOptions): void;

/** 递归盖戳建值索引(同步,小响应用) */
export function stampOrigin(obj: object, sourceId: string): bigint;

/** 分片异步盖戳(大响应,不阻塞 main thread) */
export function stampOriginChunked(root: object, sourceId: string): Promise<void>;

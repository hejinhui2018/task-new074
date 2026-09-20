/**
 * StateVault —— 版本化状态模型
 *
 * v0：2019 老版工作台的扁平结构（没有 version 字段）
 * v1：待办文本结构化为任务对象
 * v2：用户 / 外观设置收拢为档案对象
 * v3：设置独立成块，任务带时间戳
 * v4：任务 done 布尔升级为状态机 + 标签
 * v5：顶层包工作台信封，任务数组升级为字典 + 顺序表
 */

export const LATEST_VERSION = 5;
export const FIRST_VERSION = 0;

/* ----------------------------- 各版本状态类型 ----------------------------- */

export interface StateV0 {
  user: string;
  todos: string[];
  theme: string;
  notify: boolean;
}

export interface TaskV1 {
  id: string;
  title: string;
  done: boolean;
}
export interface StateV1 {
  version: 1;
  user: string;
  tasks: TaskV1[];
  theme: string;
  notify: boolean;
}

export interface ProfileV2 {
  name: string;
  theme: string;
  notify: boolean;
}
export interface StateV2 {
  version: 2;
  profile: ProfileV2;
  tasks: TaskV1[];
}

export interface TaskV3 extends TaskV1 {
  createdAt: number;
}
export interface StateV3 {
  version: 3;
  profile: { name: string };
  settings: { theme: string; notifications: boolean };
  tasks: TaskV3[];
  updatedAt: number;
}

export type TaskStatusV4 = 'todo' | 'doing' | 'done';
export interface TaskV4 {
  id: string;
  title: string;
  status: TaskStatusV4;
  tags: string[];
  createdAt: number;
}
export interface StateV4 {
  version: 4;
  profile: { name: string };
  settings: { theme: string; notifications: boolean };
  tasks: TaskV4[];
  updatedAt: number;
}

export interface StateV5 {
  version: 5;
  workbench: {
    id: string;
    profile: { name: string };
    settings: { theme: string; notifications: boolean };
  };
  tasks: Record<string, TaskV4>;
  order: string[];
  updatedAt: number;
}

export type AnyState = StateV0 | StateV1 | StateV2 | StateV3 | StateV4 | StateV5;

/* ------------------------------- 迁移定义 ------------------------------- */

export type ValidationResult = { ok: true } | { ok: false; errors: string[] };

export type FaultKind = 'throw' | 'corrupt';

export interface MigrateContext {
  clock: () => number;
}

export interface MigrationDef {
  id: string;
  from: number;
  to: number;
  title: string;
  /** 变更点（给验收台展示） */
  changes: string[];
  /** 本步校验规则 */
  validationRules: string[];
  /** 失败影响说明 */
  failureImpact: string;
  up: (input: AnyState, ctx: MigrateContext) => AnyState;
  validate: (output: unknown) => ValidationResult;
}

/* ------------------------------- 运行记录 ------------------------------- */

export type StepStatus =
  | 'pending'
  | 'applied'
  | 'skipped'
  | 'failed'
  | 'faulted';

export interface StepRecord {
  id: string;
  status: StepStatus;
  startedAt: number;
  durationMs: number;
  stage?: 'transform' | 'validate';
  validation?: ValidationResult;
  note?: string;
  quarantineId?: string;
}

export interface PendingRun {
  /** 迁移 id 序列，例如 ['0->1', '1->2'] */
  plan: string[];
  nextIndex: number;
  auto: boolean;
  fault: { stepId: string; kind: FaultKind } | null;
  startedAt: number;
}

export interface LastRun {
  startedAt: number;
  finishedAt: number | null;
  fromVersion: number;
  targetVersion: number;
  records: Record<string, StepRecord>;
}

/* ------------------------------- 快照/隔离 ------------------------------- */

export interface HistoryEntry {
  id: string;
  t: number;
  kind: 'step' | 'reset' | 'load' | 'rollback';
  label: string;
  fromVersion: number;
  toVersion: number;
  before: AnyState;
  after: AnyState;
}

export interface RollbackSnapshot {
  state: AnyState;
  reason: string;
  at: number;
}

export interface QuarantineItem {
  id: string;
  t: number;
  source: 'migration' | 'storage';
  reason: string;
  migrationId?: string;
  stage?: 'transform' | 'validate';
  /** 迁移失败时的半成品；存储损坏时可能没有 */
  payload?: unknown;
  /** 存储损坏时的原始字符串 */
  raw?: string;
}

export interface LogEvent {
  id: string;
  t: number;
  level: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

/* ------------------------------- 持久化信封 ------------------------------- */

export interface VaultEnvelope {
  format: 'statevault';
  envelopeVersion: 1;
  savedAt: number;
  live: AnyState;
  history: HistoryEntry[];
  future: HistoryEntry[];
  quarantine: QuarantineItem[];
  events: LogEvent[];
  pending: PendingRun | null;
  snapshots: RollbackSnapshot[];
  lastRun: LastRun | null;
}

export interface RecoveryReport {
  /** 上次迁移中途中断（刷新 / 崩溃） */
  interrupted: PendingRun | null;
  /** 存储信封损坏，已隔离原始数据 */
  storageFault: { raw: string; reason: string } | null;
  /** 信封里的 live 文档自身校验失败 */
  liveFault: { reason: string } | null;
}

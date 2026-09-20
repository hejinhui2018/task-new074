/**
 * StateVault 引擎（与 UI 无关）
 *
 * 不变量：
 * 1. 每个迁移步骤 = 前置快照 → 在副本上 transform → validate → 整体提交。
 *    live 只在校验通过后被替换，任何失败都不会留下半新半旧数据。
 * 2. 失败的半成品进入 quarantine，原快照保留在 snapshots，live 原样不动。
 * 3. 版本号是唯一真相：live.version !== migration.from 时该步跳过，
 *    所以同一迁移无论重跑多少次都不会重复应用。
 * 4. 每次状态变化都整封写入 localStorage；进行中的 run 以 pending 持久化，
 *    刷新后可从中断处继续。
 */
import { detectVersion, getMigration, MIGRATIONS, planMigrations, validateStateAtVersion } from './migrations';
import { VaultStorage } from './storage';
import {
  AnyState,
  FaultKind,
  HistoryEntry,
  LastRun,
  LogEvent,
  MigrateContext,
  PendingRun,
  QuarantineItem,
  RecoveryReport,
  RollbackSnapshot,
  StepRecord,
  VaultEnvelope,
} from './types';

const HISTORY_CAP = 50;
const EVENTS_CAP = 200;
const SNAPSHOT_CAP = 30;
const QUARANTINE_CAP = 50;

export interface VaultState {
  live: AnyState;
  history: HistoryEntry[];
  future: HistoryEntry[];
  quarantine: QuarantineItem[];
  events: LogEvent[];
  pending: PendingRun | null;
  snapshots: RollbackSnapshot[];
  lastRun: LastRun | null;
  recovery: RecoveryReport;
  /** live 来自无法处理的存档（未来版本 / 损坏且无快照），只读保护 */
  readOnly: boolean;
}

export interface BeginRunOptions {
  auto: boolean;
  fault?: { stepId: string; kind: FaultKind } | null;
}

let seq = 0;
const uid = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}${Math.floor(performance.now() % 1000)
    .toString(36)
    .padStart(2, '0')}`;

export function clone<T>(v: T): T {
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v)) as T;
}

/* ------------------------------- 示例种子数据 ------------------------------- */

export function seedState(version: number): AnyState {
  switch (version) {
    case 0:
      return {
        user: '老陈',
        todos: ['核对九月账单', '回复供应商邮件'],
        theme: 'dark',
        notify: true,
      };
    case 1:
      return {
        version: 1,
        user: '老陈',
        theme: 'dark',
        notify: true,
        tasks: [
          { id: 't1', title: '核对九月账单', done: true },
          { id: 't2', title: '回复供应商邮件', done: false },
        ],
      };
    case 2:
      return {
        version: 2,
        profile: { name: '老陈', theme: 'dark', notify: true },
        tasks: [
          { id: 't1', title: '核对九月账单', done: true },
          { id: 't2', title: '回复供应商邮件', done: false },
        ],
      };
    case 3:
      return {
        version: 3,
        profile: { name: '老陈' },
        settings: { theme: 'dark', notifications: true },
        tasks: [
          { id: 't1', title: '核对九月账单', done: true, createdAt: 1590000000000 },
          { id: 't2', title: '回复供应商邮件', done: false, createdAt: 1590000100000 },
        ],
        updatedAt: 1590000200000,
      };
    case 4:
      return {
        version: 4,
        profile: { name: '老陈' },
        settings: { theme: 'dark', notifications: true },
        tasks: [
          { id: 't1', title: '核对九月账单', status: 'done', tags: ['财务'], createdAt: 1590000000000 },
          { id: 't2', title: '回复供应商邮件', status: 'doing', tags: [], createdAt: 1590000100000 },
        ],
        updatedAt: 1590000200000,
      };
    case 5:
      return {
        version: 5,
        workbench: {
          id: 'wb-seed0001',
          profile: { name: '老陈' },
          settings: { theme: 'dark', notifications: true },
        },
        tasks: {
          t1: { id: 't1', title: '核对九月账单', status: 'done', tags: ['财务'], createdAt: 1590000000000 },
          t2: { id: 't2', title: '回复供应商邮件', status: 'doing', tags: [], createdAt: 1590000100000 },
        },
        order: ['t1', 't2'],
        updatedAt: 1590000200000,
      };
    default:
      throw new Error(`未知种子版本 v${version}`);
  }
}

/* --------------------------- 故障注入：构造半成品 --------------------------- */

/** 在迁移产物上故意制造“半新半旧 / 非法”数据，供校验拦截并隔离 */
function damageDraft(stepId: string, output: AnyState): AnyState {
  const d = clone(output) as unknown as Record<string, unknown>;
  switch (stepId) {
    case '0->1': {
      const tasks = d.tasks as Array<Record<string, unknown>>;
      if (tasks.length) tasks[tasks.length - 1].id = tasks[0].id as string; // 重复 id
      return d as unknown as AnyState;
    }
    case '1->2':
      (d.profile as Record<string, unknown>).name = '   '; // 空名字
      return d as unknown as AnyState;
    case '2->3': {
      const tasks = d.tasks as Array<Record<string, unknown>>;
      if (tasks.length) tasks[0].createdAt = 'not-a-timestamp'; // 时间戳损坏
      return d as unknown as AnyState;
    }
    case '3->4': {
      const tasks = d.tasks as Array<Record<string, unknown>>;
      if (tasks.length) {
        tasks[0].status = 'blocked'; // 非法状态机值
        tasks[0].done = true; // 旧字段残留 → 半新半旧
      }
      return d as unknown as AnyState;
    }
    case '4->5': {
      (d.order as string[]).push('ghost-task'); // 顺序表引用了不存在的任务
      return d as unknown as AnyState;
    }
    default:
      return d as unknown as AnyState;
  }
}

/* --------------------------------- 引擎 --------------------------------- */

export class VaultEngine {
  private storage: VaultStorage;
  private state: VaultState;
  private listeners = new Set<() => void>();
  private clock: () => number;

  constructor(storage?: VaultStorage, clock: () => number = () => Date.now()) {
    this.storage = storage ?? new VaultStorage();
    this.clock = clock;
    this.state = this.boot();
  }

  /* ----------------------------- 订阅 / 快照 ----------------------------- */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): VaultState => this.state;

  private emit(): void {
    this.persist();
    this.listeners.forEach((fn) => fn());
  }

  private patch(p: Partial<VaultState>): void {
    this.state = { ...this.state, ...p };
  }

  /* ------------------------------- 启动恢复 ------------------------------- */

  private boot(): VaultState {
    const initial: VaultState = {
      live: seedState(0),
      history: [],
      future: [],
      quarantine: [],
      events: [],
      pending: null,
      snapshots: [],
      lastRun: null,
      recovery: { interrupted: null, storageFault: null, liveFault: null },
      readOnly: false,
    };

    const read = this.storage.read();
    if (!read.ok) {
      // 存储损坏：原文隔离，绝不用新数据覆盖它（envelope 单独保留 raw）
      const q: QuarantineItem = {
        id: uid('q'),
        t: this.clock(),
        source: 'storage',
        reason: read.reason,
        raw: read.raw,
      };
      const seeded = seedState(0);
      const state: VaultState = {
        ...initial,
        live: seeded,
        quarantine: [q],
        history: [this.historyEntry('load', '存储损坏，初始化安全示例存档', seeded, seeded)],
        recovery: { interrupted: null, storageFault: { raw: read.raw, reason: read.reason }, liveFault: null },
        events: [
          this.event('error', `本地存档损坏已隔离：${read.reason}`),
          this.event('info', '已载入 v0 安全示例，原数据未被覆盖，可在隔离区查看原文'),
        ],
      };
      this.state = state;
      this.persist();
      return state;
    }

    if (read.envelope === null) {
      const seeded = seedState(0);
      const state: VaultState = {
        ...initial,
        live: seeded,
        history: [this.historyEntry('load', '首次使用，初始化 v0 示例存档', seeded, seeded)],
        events: [this.event('info', '首次打开：初始化 v0（2019 老版）示例存档')],
      };
      this.state = state;
      this.persist();
      return state;
    }

    return this.restoreEnvelope(read.envelope);
  }

  private restoreEnvelope(env: VaultEnvelope): VaultState {
    const events = [...env.events];
    const quarantine = [...env.quarantine];
    const recovery: RecoveryReport = { interrupted: null, storageFault: null, liveFault: null };

    const version = detectVersion(env.live);

    // 未来版本：当前代码读不了 → 只读保护，原样保留
    const rawVersion = (env.live as { version?: unknown })?.version;
    if (version === null && typeof rawVersion === 'number' && rawVersion > 5) {
      recovery.liveFault = { reason: `存档来自更新的版本 v${rawVersion}，当前代码最高支持 v5（降级读取保护）` };
      events.push(this.event('error', `检测到未来版本 v${rawVersion} 存档，已保持原样并进入只读模式`));
      return this.finalizeRestore(env, events, quarantine, recovery, env.live, true);
    }

    if (version === null) {
      // live 彻底损坏：隔离，尝试回退到最近的回滚快照
      const reason = 'live 文档结构无法识别';
      quarantine.push({
        id: uid('q'),
        t: this.clock(),
        source: 'storage',
        reason,
        payload: env.live,
      });
      recovery.liveFault = { reason };
      const fallback = env.snapshots?.[env.snapshots.length - 1]?.state;
      if (fallback && detectVersion(fallback) !== null) {
        events.push(this.event('warn', 'live 文档损坏已隔离，已回退到最近的回滚快照'));
        return this.finalizeRestore(env, events, quarantine, recovery, fallback, false);
      }
      events.push(this.event('error', 'live 文档损坏且无可用快照，进入只读模式等待人工处理'));
      return this.finalizeRestore(env, events, quarantine, recovery, env.live, true);
    }

    const check = validateStateAtVersion(version, env.live);
    if (!check.ok) {
      const reason = `v${version} 文档未通过校验：${check.errors.join('；')}`;
      quarantine.push({
        id: uid('q'),
        t: this.clock(),
        source: 'storage',
        reason,
        payload: env.live,
      });
      recovery.liveFault = { reason };
      const fallback = env.snapshots?.[env.snapshots.length - 1]?.state;
      if (fallback && detectVersion(fallback) !== null && validateStateAtVersion(detectVersion(fallback)!, fallback).ok) {
        events.push(this.event('warn', `live 未通过校验已隔离，已回滚到快照 v${detectVersion(fallback)}`));
        return this.finalizeRestore(env, events, quarantine, recovery, fallback, false);
      }
      events.push(this.event('error', 'live 校验失败且无干净快照，进入只读模式'));
      return this.finalizeRestore(env, events, quarantine, recovery, env.live, true);
    }

    // 正常恢复
    if (env.pending) {
      // 自动运行不自动续跑，交用户决定；标记中断信息
      env.pending.auto = false;
      recovery.interrupted = env.pending;
      const doneCount = env.pending.nextIndex;
      events.push(
        this.event(
          'warn',
          `检测到上次迁移在第 ${doneCount + 1} 步前中断（已提交 ${doneCount} 步，live=v${version}），可继续或放弃`,
        ),
      );
    } else {
      events.push(this.event('success', `存档恢复成功：live = v${version}`));
    }

    return this.finalizeRestore(env, events, quarantine, recovery, env.live, false);
  }

  private finalizeRestore(
    env: VaultEnvelope,
    events: LogEvent[],
    quarantine: QuarantineItem[],
    recovery: RecoveryReport,
    live: AnyState,
    readOnly: boolean,
  ): VaultState {
    const state: VaultState = {
      live,
      history: env.history ?? [],
      future: env.future ?? [],
      quarantine,
      events: events.slice(-EVENTS_CAP),
      pending: recovery.interrupted,
      snapshots: env.snapshots ?? [],
      lastRun: env.lastRun ?? null,
      recovery,
      readOnly,
    };
    this.state = state;
    this.persist();
    return state;
  }

  /* ------------------------------- 迁移运行 ------------------------------- */

  /** 当前 live 到最新版的计划（空计划 = 已在最新） */
  currentPlan(): ReturnType<typeof planMigrations> {
    const v = detectVersion(this.state.live);
    if (v === null) return [];
    return planMigrations(v);
  }

  beginRun(opts: BeginRunOptions): void {
    if (this.state.readOnly) return;
    if (this.state.pending) {
      // 已有计划（可能是中断恢复的）：只切换自动模式
      this.patch({ pending: { ...this.state.pending, auto: opts.auto } });
      this.log(opts.auto ? 'info' : 'info', '沿用现有迁移计划继续执行');
      this.emit();
      return;
    }
    const v = detectVersion(this.state.live);
    if (v === null) return;
    const plan = planMigrations(v);
    if (plan.length === 0) {
      // 幂等性：已是最新版本，重跑不产生任何变更
      const now = this.clock();
      this.patch({
        lastRun: {
          startedAt: now,
          finishedAt: now,
          fromVersion: v,
          targetVersion: v,
          records: {},
        },
      });
      this.log('success', `live 已是 v${v}，没有待执行的迁移 —— 重复执行不会重复应用`);
      this.emit();
      return;
    }
    const pending: PendingRun = {
      plan: plan.map((m) => m.id),
      nextIndex: 0,
      auto: opts.auto,
      fault: opts.fault ?? null,
      startedAt: this.clock(),
    };
    const run: LastRun = {
      startedAt: this.clock(),
      finishedAt: null,
      fromVersion: v,
      targetVersion: plan[plan.length - 1].to,
      records: {},
    };
    this.patch({ pending, lastRun: run });
    this.log('info', `迁移计划建立：v${v} → v${run.targetVersion}，共 ${plan.length} 步（${opts.auto ? '自动' : '单步'}）`);
    this.emit();
  }

  /** 推进一个迁移步骤（自动 / 单步都走这里） */
  tick(): StepRecord | null {
    const { readOnly } = this.state;
    let pending = this.state.pending;
    if (!pending || readOnly) return null;

    const stepId = pending.plan[pending.nextIndex];
    const m = getMigration(stepId);
    if (!m) throw new Error(`计划引用了未知迁移 ${stepId}`);

    const currentVersion = detectVersion(this.state.live);
    const startedAt = this.clock();

    // 幂等闸门：版本号不对就不执行
    if (currentVersion === null) return null;
    if (currentVersion > m.from) {
      const rec: StepRecord = {
        id: m.id,
        status: 'skipped',
        startedAt,
        durationMs: 0,
        note: `live 已是 v${currentVersion}，本步此前已应用，跳过（不重复应用）`,
      };
      this.commitRecord(rec);
      this.advanceOrFinish(rec);
      this.log('info', `${m.id} 跳过：迁移已应用过`);
      this.emit();
      return rec;
    }
    if (currentVersion < m.from) {
      const rec: StepRecord = this.failRecord(m.id, startedAt, 'transform', `版本断档：期望从 v${m.from} 出发，实际 v${currentVersion}`);
      this.patch({ pending: null });
      this.commitRecord(rec);
      this.log('error', `${m.id} 失败：版本断档`);
      this.emit();
      return rec;
    }

    // 1) 前置回滚快照（深拷贝，live 之后任何变化都影响不到它）
    const pre = clone(this.state.live);
    const snapshots = [
      ...this.state.snapshots,
      { state: pre, reason: `迁移 ${m.id}（${m.title}）前置快照`, at: startedAt },
    ].slice(-SNAPSHOT_CAP);

    // 故障仅对匹配的步骤生效一次
    const faultHere = pending.fault?.stepId === m.id ? pending.fault : null;
    if (faultHere) {
      pending = { ...pending, fault: null };
      this.patch({ pending });
    }

    let draft: AnyState;
    try {
      const ctx: MigrateContext = { clock: this.clock };
      draft = m.up(clone(pre), ctx);
      if (faultHere?.kind === 'throw') {
        throw new Error('故障注入：迁移函数在 transform 阶段抛出异常');
      }
      if (faultHere?.kind === 'corrupt') {
        draft = damageDraft(m.id, draft);
        this.log('warn', `${m.id} 故障注入：已生成半成品数据，交给校验`);
      }
    } catch (e) {
      const rec: StepRecord = {
        id: m.id,
        status: 'faulted',
        startedAt,
        durationMs: this.clock() - startedAt,
        stage: 'transform',
        note: e instanceof Error ? e.message : String(e),
      };
      const q: QuarantineItem = {
        id: uid('q'),
        t: this.clock(),
        source: 'migration',
        migrationId: m.id,
        stage: 'transform',
        reason: rec.note!,
        payload: { attemptedFrom: m.from, targetTo: m.to, inputSnapshot: pre },
      };
      // live 保持 pre，未被赋值过；快照保留；run 中止
      this.patch({
        snapshots,
        quarantine: [...this.state.quarantine, q].slice(-QUARANTINE_CAP),
        pending: null,
      });
      this.commitRecord(rec);
      this.log('error', `${m.id} transform 抛错：live 保持 v${m.from}，现场已隔离`);
      this.emit();
      return rec;
    }

    // 2) 校验（在提交前）
    const validation = m.validate(draft);
    if (!validation.ok) {
      const rec: StepRecord = {
        id: m.id,
        status: 'failed',
        startedAt,
        durationMs: this.clock() - startedAt,
        stage: 'validate',
        validation,
        note: validation.errors.join('；'),
      };
      const q: QuarantineItem = {
        id: uid('q'),
        t: this.clock(),
        source: 'migration',
        migrationId: m.id,
        stage: 'validate',
        reason: `校验未通过：${validation.errors.join('；')}`,
        payload: draft, // 半成品隔离，原快照不被覆盖
      };
      this.patch({
        snapshots,
        quarantine: [...this.state.quarantine, q].slice(-QUARANTINE_CAP),
        pending: null,
      });
      this.commitRecord(rec);
      this.log('error', `${m.id} 校验失败，已整体回滚：live 仍是 v${m.from}，半成品进入隔离区`);
      this.emit();
      return rec;
    }

    // 3) 原子提交：live 一次性替换
    const after = clone(draft);
    const entry = this.historyEntry('step', `${m.id} ${m.title}`, pre, after);
    const rec: StepRecord = {
      id: m.id,
      status: 'applied',
      startedAt,
      durationMs: this.clock() - startedAt,
      stage: 'validate',
      validation,
    };
    this.patch({
      live: after,
      snapshots,
      history: [...this.state.history, entry].slice(-HISTORY_CAP),
      future: [], // 新提交会清空重做栈
    });
    this.commitRecord(rec);
    this.advanceOrFinish(rec);
    this.log('success', `${m.id} 完成：v${m.from} → v${m.to}（${rec.durationMs}ms，校验通过）`);
    this.emit();
    return rec;
  }

  private advanceOrFinish(rec: StepRecord): void {
    const pending = this.state.pending!;
    const nextIndex = pending.nextIndex + 1;
    const lastRun = this.state.lastRun;
    if (nextIndex >= pending.plan.length) {
      this.patch({
        pending: null,
        lastRun: lastRun ? { ...lastRun, finishedAt: this.clock(), records: { ...lastRun.records, [rec.id]: rec } } : lastRun,
      });
      const v = detectVersion(this.state.live);
      this.log('success', `全部迁移结束，live = v${v}。再点运行也不会重复应用任何一步`);
    } else {
      this.patch({
        pending: { ...pending, nextIndex },
      });
    }
  }

  private commitRecord(rec: StepRecord): void {
    const lastRun = this.state.lastRun;
    if (!lastRun) return;
    this.patch({ lastRun: { ...lastRun, records: { ...lastRun.records, [rec.id]: rec } } });
  }

  pause(): void {
    if (!this.state.pending) return;
    this.patch({ pending: { ...this.state.pending, auto: false } });
    this.log('info', '自动运行已暂停');
    this.emit();
  }

  /** 运行中（含暂停态）给尚未执行的某一步武装一次性故障 */
  armFault(stepId: string | null, kind: FaultKind = 'corrupt'): void {
    if (!this.state.pending) return;
    this.patch({
      pending: { ...this.state.pending, fault: stepId ? { stepId, kind } : null },
    });
    if (stepId) this.log('warn', `故障已武装：将在 ${stepId} 触发（${kind === 'throw' ? 'transform 抛异常' : '生成损坏半成品'}）`);
    this.emit();
  }

  resume(): void {
    if (!this.state.pending || this.state.readOnly) return;
    this.patch({ pending: { ...this.state.pending, auto: true } });
    this.log('info', '自动运行继续');
    this.emit();
  }

  /** 中断恢复后用户选择放弃 pending（已提交的步骤保留在 live） */
  abortPending(): void {
    if (!this.state.pending) return;
    this.patch({ pending: null });
    this.log('info', '已放弃中断的迁移计划，已提交的步骤保留在 live 中');
    this.emit();
  }

  /** 清除恢复提示（不改变数据） */
  dismissRecovery(): void {
    this.patch({ recovery: { interrupted: null, storageFault: null, liveFault: null } });
    this.emit();
  }

  /* ------------------------------- 撤销 / 重做 ------------------------------- */

  undo(): void {
    const entry = this.state.history[this.state.history.length - 1];
    if (!entry || this.state.pending || this.state.readOnly) return;
    const before = clone(entry.before);
    this.patch({
      live: before,
      history: this.state.history.slice(0, -1),
      future: [...this.state.future, entry],
    });
    const v = detectVersion(before);
    this.log('info', `撤销「${entry.label}」：live 回退到 v${v}（快照恢复，未重跑迁移）`);
    this.emit();
  }

  redo(): void {
    const entry = this.state.future[this.state.future.length - 1];
    if (!entry || this.state.pending || this.state.readOnly) return;
    const after = clone(entry.after);
    this.patch({
      live: after,
      future: this.state.future.slice(0, -1),
      history: [...this.state.history, entry],
    });
    const v = detectVersion(after);
    this.log('info', `重做「${entry.label}」：live 恢复到 v${v}`);
    this.emit();
  }

  /** 从回滚快照恢复（产生一条新的历史，可再撤销） */
  restoreSnapshot(index: number): void {
    const snap = this.state.snapshots[index];
    if (!snap || this.state.pending || this.state.readOnly) return;
    const before = clone(this.state.live);
    const after = clone(snap.state);
    const entry = this.historyEntry('rollback', `从回滚快照恢复（${snap.reason}）`, before, after);
    this.patch({
      live: after,
      history: [...this.state.history, entry].slice(-HISTORY_CAP),
      future: [],
    });
    this.log('warn', `已从回滚快照恢复 live → v${detectVersion(after)}`);
    this.emit();
  }

  /** 恢复最近的一个回滚快照 */
  restoreLastSnapshot(): boolean {
    const i = this.state.snapshots.length - 1;
    if (i < 0) return false;
    this.restoreSnapshot(i);
    return true;
  }

  /* --------------------------------- 重置 --------------------------------- */

  resetTo(version: number): void {
    const seeded = seedState(version);
    const entry = this.historyEntry('reset', `重置为 v${version} 示例存档`, seeded, seeded);
    this.patch({
      live: seeded,
      history: [entry],
      future: [],
      quarantine: [],
      events: [this.event('info', `验收台已重置为 v${version} 示例存档，隔离区与快照已清空`)],
      pending: null,
      snapshots: [],
      lastRun: null,
      recovery: { interrupted: null, storageFault: null, liveFault: null },
      readOnly: false,
    });
    this.emit();
  }

  /* --------------------------------- 隔离区 --------------------------------- */

  removeQuarantine(id: string): void {
    this.patch({ quarantine: this.state.quarantine.filter((q) => q.id !== id) });
    this.log('info', '已从隔离区移除一条记录');
    this.emit();
  }

  clearQuarantine(): void {
    if (!this.state.quarantine.length) return;
    this.patch({ quarantine: [] });
    this.log('info', '隔离区已清空（不影响 live 与快照）');
    this.emit();
  }

  /* --------------------------------- 工具 --------------------------------- */

  private historyEntry(kind: HistoryEntry['kind'], label: string, before: AnyState, after: AnyState): HistoryEntry {
    return { id: uid('h'), t: this.clock(), kind, label, fromVersion: detectVersion(before) ?? -1, toVersion: detectVersion(after) ?? -1, before, after };
  }

  private event(level: LogEvent['level'], text: string): LogEvent {
    return { id: uid('e'), t: this.clock(), level, text };
  }

  private log(level: LogEvent['level'], text: string): void {
    this.patch({ events: [...this.state.events, this.event(level, text)].slice(-EVENTS_CAP) });
  }

  private failRecord(id: string, startedAt: number, stage: 'transform' | 'validate', note: string): StepRecord {
    return { id, status: 'failed', startedAt, durationMs: this.clock() - startedAt, stage, note };
  }

  persist(): void {
    if (!this.storage.available) return;
    const s = this.state;
    const envelope: VaultEnvelope = {
      format: 'statevault',
      envelopeVersion: 1,
      savedAt: this.clock(),
      live: s.live,
      history: s.history,
      future: s.future,
      quarantine: s.quarantine,
      events: s.events,
      pending: s.pending,
      snapshots: s.snapshots,
      lastRun: s.lastRun,
    };
    this.storage.write(envelope);
  }

  /** 供“降级读取”场景：直接写入一个 v6 未来存档 */
  writeFutureEnvelope(): void {
    const future = {
      version: 6,
      workbench: { id: 'wb-future', profile: { name: '未来用户' }, settings: { theme: 'neon', notifications: true, aiAssist: true } },
      tasks: {},
      order: [],
      updatedAt: this.clock(),
    };
    this.storage.write({
      format: 'statevault',
      envelopeVersion: 1,
      savedAt: this.clock(),
      live: future as unknown as AnyState,
      history: [],
      future: [],
      quarantine: [],
      events: [],
      pending: null,
      snapshots: [],
      lastRun: null,
    });
  }

  /** 供“存储损坏”场景：直接写入无法解析的内容 */
  writeGarbage(): void {
    this.storage.writeRaw('{__statevault_corrupted__: true, todos: [unterminated');
  }
}

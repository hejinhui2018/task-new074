import {
  LATEST_VERSION,
  type VaultState,
  factoryV1,
  factoryV3,
  futureV7,
} from './states.ts'
import {
  allMigrations,
  migrationByFrom,
  planFrom,
  stepId,
  validateSnapshot,
  type MigrationStep,
  type ValidationIssue,
} from './migrations.ts'
import { FaultBoard, sabotageOutput, type FaultKind } from './faults.ts'
import { STORAGE_KEYS, type KV } from './storage.ts'

// ---- 持久化结构 ----

/** 主快照信封：原子迁移的提交单位 */
export interface VaultDoc {
  envelope: 1
  state: VaultState
  updatedAt: string
}

export type StagingPhase = 'staged' | 'committed'

/** 预写日志：转换开始前落盘，提交完成后清除 */
export interface StagingRecord {
  envelope: 1
  kind: 'migration'
  stepId: string
  from: number
  to: number
  phase: StagingPhase
  startedAt: string
  runNonce: number
}

export type QuarantineReason = 'corrupted' | 'validation' | 'unsupported-version'

export interface QuarantineItem {
  id: string
  reason: QuarantineReason
  source: 'main-snapshot' | 'migration-output'
  stepId?: string
  capturedAt: string
  detail: string
  issues?: ValidationIssue[]
  /** 被隔离的原始数据（字符串解析失败时保留原始文本） */
  raw: unknown
}

export type LogLevel = 'info' | 'success' | 'warn' | 'error'

export interface LogEntry {
  id: number
  t: string
  level: LogLevel
  message: string
  stepId?: string
}

interface PersistedMeta {
  quarantine: QuarantineItem[]
  logs: LogEntry[]
}

// ---- 运行结果 ----

export type StepResult =
  | { kind: 'applied'; step: MigrationStep; output: VaultState; fault?: never }
  | { kind: 'failed'; step: MigrationStep; reason: string; issues: ValidationIssue[] }
  | { kind: 'crash'; step: MigrationStep; fault: FaultKind }
  | { kind: 'skipped'; reason: string }

export type EngineMode = 'normal' | 'future-readonly'
export type LoadStatus = 'empty' | 'ok' | 'quarantined'

export interface UndoCheckpoint {
  doc: VaultDoc
  label: string
  t: string
}

/** 落盘的回滚快照：每次提交前保存的上一个完好版本 */
export interface RollbackSnapshot {
  doc: VaultDoc
  savedAt: string
  stepId: string
}

export interface EngineView {
  status: LoadStatus
  mode: EngineMode
  version: number | null
  state: VaultState | null
  rawFuture: unknown
  loadError: string | null
  doc: VaultDoc | null
  staging: StagingRecord | null
  quarantine: QuarantineItem[]
  logs: LogEntry[]
  undoDepth: number
  redoDepth: number
  dead: boolean
  plan: MigrationStep[]
  faults: ReturnType<FaultBoard['snapshot']>
  rollback: RollbackSnapshot | null
}

export class SimulatedCrash extends Error {
  readonly fault: FaultKind
  constructor(fault: FaultKind) {
    super(`模拟断电：${fault}`)
    this.name = 'SimulatedCrash'
    this.fault = fault
  }
}

const truncateJson = (json: string): string => json.slice(0, Math.max(20, Math.floor(json.length * 0.4)))

/** 键排序的 JSON 序列化，用作隔离去重指纹 */
const stableStringify = (v: unknown): string => {
  const seen = new WeakSet<object>()
  const sort = (val: unknown): unknown => {
    if (typeof val !== 'object' || val === null) return val
    if (seen.has(val as object)) return '[circular]'
    seen.add(val as object)
    if (Array.isArray(val)) return val.map(sort)
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sort(x)]),
    )
  }
  return JSON.stringify(sort(v))
}

export class MigrationEngine {
  private doc: VaultDoc | null = null
  private rawFuture: unknown = null
  private mode: EngineMode = 'normal'
  private status: LoadStatus = 'empty'
  private loadError: string | null = null
  private staging: StagingRecord | null = null
  private quarantine: QuarantineItem[] = []
  private logs: LogEntry[] = []
  private undoStack: UndoCheckpoint[] = []
  private redoStack: UndoCheckpoint[] = []
  private logSeq = 0
  private nonce = 0
  /** 崩溃后引擎"死亡"，必须 recover()（即模拟刷新）才能继续操作 */
  private dead = false
  private rollback: RollbackSnapshot | null = null
  readonly faults = new FaultBoard()

  private readonly kv: KV
  private readonly clock: () => string

  constructor(kv: KV, clock?: () => string) {
    this.kv = kv
    this.clock = clock ?? (() => new Date().toISOString())
  }

  // ================= 启动 / 恢复 =================

  boot(): void {
    this.loadMeta()
    this.loadDoc()
    this.loadRollback()
    this.recoverStaging()
    this.log('info', `启动完成：${this.describeStatus()}`)
  }

  /** 模拟浏览器刷新：重新从磁盘读取一切（undo 栈是会话级，会清空） */
  recover(): void {
    this.dead = false
    this.undoStack = []
    this.redoStack = []
    this.loadMeta()
    this.loadDoc()
    this.loadRollback()
    this.recoverStaging()
    this.log('info', `刷新恢复完成：${this.describeStatus()}`)
  }

  private loadRollback(): void {
    const raw = this.kv.get(STORAGE_KEYS.rollback)
    if (!raw) {
      this.rollback = null
      return
    }
    try {
      const snap = JSON.parse(raw) as RollbackSnapshot
      if (snap?.doc?.state && validateSnapshot(snap.doc.state).length === 0) {
        this.rollback = snap
      } else {
        this.rollback = null
        this.log('warn', '回滚快照自身校验未通过，已忽略（不覆盖任何数据）')
      }
    } catch {
      this.rollback = null
    }
  }

  private describeStatus(): string {
    if (this.status === 'empty') return '未发现本地快照'
    if (this.status === 'quarantined') return `主快照已隔离（${this.loadError}）`
    if (this.mode === 'future-readonly') return `检测到未来版本 v${this.versionOf(this.rawFuture)}，降级只读打开`
    return `主快照 v${this.doc?.state.version ?? '?'}，模式可读写`
  }

  private loadMeta(): void {
    const raw = this.kv.get(STORAGE_KEYS.meta)
    if (!raw) {
      this.quarantine = []
      this.logs = []
      return
    }
    try {
      const meta = JSON.parse(raw) as Partial<PersistedMeta>
      this.quarantine = Array.isArray(meta.quarantine) ? meta.quarantine : []
      this.logs = Array.isArray(meta.logs) ? meta.logs : []
      this.logSeq = this.logs.reduce((m, l) => Math.max(m, l.id), 0)
    } catch {
      // 元信息坏了不致命，重建（隔离区是安全资产，理论上不应丢——这里记录一条日志）
      this.quarantine = []
      this.logs = []
      this.persistMeta()
    }
  }

  private persistMeta(): void {
    const meta: PersistedMeta = {
      quarantine: this.quarantine,
      logs: this.logs.slice(-300),
    }
    this.kv.set(STORAGE_KEYS.meta, JSON.stringify(meta))
  }

  private versionOf(v: unknown): number | null {
    return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).version === 'number'
      ? ((v as Record<string, unknown>).version as number)
      : null
  }

  private loadDoc(): void {
    this.doc = null
    this.rawFuture = null
    this.mode = 'normal'
    this.status = 'empty'
    this.loadError = null
    this.staging = null

    const raw = this.kv.get(STORAGE_KEYS.doc)
    if (raw === null) return

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.status = 'quarantined'
      this.loadError = '主快照不是合法 JSON（半截写入 / 字节损坏）'
      this.sendToQuarantine('corrupted', 'main-snapshot', this.loadError, raw)
      return
    }

    const ver = this.versionOf(parsed)

    // 未来版本：不认识、不迁移、不覆盖，降级只读
    if (ver !== null && ver > LATEST_VERSION) {
      this.status = 'ok'
      this.mode = 'future-readonly'
      this.rawFuture = parsed
      return
    }

    // 信封检查
    const envOk =
      typeof parsed === 'object' && parsed !== null &&
      (parsed as Record<string, unknown>).envelope === 1 &&
      typeof (parsed as Record<string, unknown>).state === 'object'
    if (!envOk) {
      this.status = 'quarantined'
      this.loadError = '缺少迁移信封（envelope=1 + state）'
      this.sendToQuarantine('validation', 'main-snapshot', this.loadError, parsed)
      return
    }

    const state = (parsed as VaultDoc).state
    const issues = validateSnapshot(state)
    if (issues.length > 0) {
      this.status = 'quarantined'
      this.loadError = `主快照 v${this.versionOf(state)} 校验未通过（${issues.length} 项）`
      this.sendToQuarantine('validation', 'main-snapshot', this.loadError, parsed, issues)
      return
    }

    if (ver !== null && ver < 1) {
      this.status = 'quarantined'
      this.loadError = `版本 v${ver} 已不受支持`
      this.sendToQuarantine('unsupported-version', 'main-snapshot', this.loadError, parsed)
      return
    }

    this.doc = parsed as VaultDoc
    this.status = 'ok'
  }

  private recoverStaging(): void {
    const raw = this.kv.get(STORAGE_KEYS.staging)
    if (raw === null) return
    let rec: StagingRecord | null = null
    try {
      rec = JSON.parse(raw) as StagingRecord
    } catch {
      this.kv.remove(STORAGE_KEYS.staging)
      this.log('warn', '暂存日志损坏，已丢弃')
      return
    }
    if (!rec || rec.kind !== 'migration') {
      this.kv.remove(STORAGE_KEYS.staging)
      return
    }
    this.staging = rec

    const currentVersion = this.doc ? this.doc.state.version : null

    if (rec.phase === 'committed' || currentVersion === rec.to) {
      // 提交已落盘、清暂存前崩溃。幂等关键：版本号已是 to，就绝不再跑一遍。
      this.kv.remove(STORAGE_KEYS.staging)
      this.staging = null
      this.log('success', `崩溃恢复：检测到 ${rec.stepId} 已提交（v${rec.to}），仅清理暂存日志，迁移不重复执行`)
      return
    }

    if (this.status === 'quarantined') {
      this.kv.remove(STORAGE_KEYS.staging)
      this.staging = null
      this.log('error', `崩溃恢复：${rec.stepId} 中断且主快照已损坏，数据已进隔离区，等待人工处理`)
      return
    }

    // phase=staged 且主快照仍停在 from：转换结果从未提交，旧快照完好。
    this.kv.remove(STORAGE_KEYS.staging)
    this.staging = null
    this.log('warn', `崩溃恢复：${rec.stepId} 在提交前中断，主快照仍为 v${currentVersion ?? '?'}（未被破坏），丢弃半成品暂存`)
  }

  // ================= 迁移执行 =================

  /** 干净中止：转换/校验没过，转换从未提交，清掉暂存日志 */
  private abortStaging(): void {
    this.kv.remove(STORAGE_KEYS.staging)
    this.staging = null
  }

  currentPlan(): MigrationStep[] {
    if (!this.doc || this.mode !== 'normal') return []
    return planFrom(this.doc.state.version, LATEST_VERSION)
  }

  /** 执行计划中的下一步。同一迁移重跑由版本号 + 暂存日志双重保证幂等。 */
  applyStep(): StepResult {
    if (this.dead) {
      return { kind: 'skipped', reason: '进程已在崩溃后终止，请先"刷新恢复"' }
    }
    if (this.status === 'empty') return { kind: 'skipped', reason: '没有可迁移的快照' }
    if (this.status === 'quarantined') return { kind: 'skipped', reason: '主快照在隔离区，不能迁移' }
    if (this.mode === 'future-readonly') return { kind: 'skipped', reason: '未来版本只读，不能迁移' }

    const plan = this.currentPlan()
    const step = plan[0]
    if (!step) return { kind: 'skipped', reason: `已在最新版 v${LATEST_VERSION}` }

    const id = stepId(step.from, step.to)
    if (this.doc!.state.version !== step.from) {
      return { kind: 'skipped', reason: `当前 v${this.doc!.state.version} 与步骤起点 v${step.from} 不连续` }
    }

    const fault = this.faults.consume(id)
    this.nonce += 1
    const startedAt = this.clock()

    // 1) 预写日志先落盘
    this.staging = {
      envelope: 1,
      kind: 'migration',
      stepId: id,
      from: step.from,
      to: step.to,
      phase: 'staged',
      startedAt,
      runNonce: this.nonce,
    }
    this.kv.set(STORAGE_KEYS.staging, JSON.stringify(this.staging))
    this.log('info', `开始执行 ${id}：${step.title}`, id)

    // 2) 转换前断电（刷新场景）
    if (fault === 'crashAfterStaging') {
      this.log('error', `故障注入：${id} 暂存落盘后、转换前断电`, id)
      this.dead = true
      return { kind: 'crash', step, fault }
    }

    // 3) 纯内存转换（失败绝不触碰主快照）
    let output: VaultState
    try {
      output = step.transform(this.doc!.state as never, { clock: this.clock })
    } catch (e) {
      this.abortStaging()
      this.log('error', `${id} 迁移函数抛异常：${(e as Error).message}；主快照 v${step.from} 保持原样`, id)
      return { kind: 'failed', step, reason: `迁移函数异常：${(e as Error).message}`, issues: [] }
    }
    if (fault === 'transformThrow') {
      this.abortStaging()
      this.log('error', `故障注入：${id} 读取到意外字段，迁移函数中断；主快照未被改写`, id)
      return { kind: 'failed', step, reason: '注入故障：迁移函数读取未定义字段后抛出', issues: [] }
    }

    // 4) 提交前校验产物
    let candidate: unknown = output
    if (fault === 'badOutput') {
      candidate = sabotageOutput(id, output as unknown as Record<string, unknown>)
      this.log('warn', `故障注入：${id} 产物被篡改，等待 outputChecks 拦截`, id)
    }
    const issues = validateSnapshot(candidate)
    if (issues.length > 0) {
      this.abortStaging()
      this.sendToQuarantine('validation', 'migration-output', `${id} 产物校验失败，拒绝提交`, candidate, issues, id)
      this.log('error', `${id} 产物校验失败 ${issues.length} 项，已隔离半成品；主快照 v${step.from} 完好`, id)
      return { kind: 'failed', step, reason: '产物校验失败', issues }
    }

    // 5) 原子提交：回滚快照 → 主快照 → 暂存标记 committed → 清除暂存
    const nextDoc: VaultDoc = { envelope: 1, state: candidate as VaultState, updatedAt: this.clock() }

    // 撤销检查点（提交前的完整快照，会话级）
    this.undoStack.push({ doc: this.doc!, label: `迁移 ${id}`, t: this.clock() })
    this.redoStack = []

    // 回滚快照先落盘：保留上一个已验证完好的版本，损坏时可恢复且不动隔离区
    this.rollback = { doc: this.doc!, savedAt: this.clock(), stepId: id }
    this.kv.set(STORAGE_KEYS.rollback, JSON.stringify(this.rollback))

    if (fault === 'corruptDocWrite') {
      this.kv.set(STORAGE_KEYS.doc, truncateJson(JSON.stringify(nextDoc)))
      this.log('error', `故障注入：${id} 主快照只写了一半就断电（回滚快照已先行落盘）`, id)
      this.dead = true
      return { kind: 'crash', step, fault }
    }

    this.kv.set(STORAGE_KEYS.doc, JSON.stringify(nextDoc))

    if (fault === 'crashAfterDocWrite') {
      this.log('error', `故障注入：${id} 主快照已写入、标记提交前断电`, id)
      this.dead = true
      return { kind: 'crash', step, fault }
    }

    this.staging = { ...this.staging, phase: 'committed' }
    this.kv.set(STORAGE_KEYS.staging, JSON.stringify(this.staging))
    this.kv.remove(STORAGE_KEYS.staging)
    this.staging = null

    this.doc = nextDoc
    this.log('success', `${id} 提交完成：v${step.from} → v${step.to}（校验全过，暂存已清）`, id)
    return { kind: 'applied', step, output: nextDoc.state }
  }

  /** 重放整条迁移链（自动运行用）；遇故障 / 崩溃 / 校验失败立即停 */
  runUntil(target: number = LATEST_VERSION): { applied: number; last: StepResult } {
    let applied = 0
    let last: StepResult = { kind: 'skipped', reason: '无需运行' }
    while (true) {
      const v = this.doc?.state.version ?? 0
      if (v >= target) break
      last = this.applyStep()
      if (last.kind === 'applied') applied += 1
      else break
    }
    return { applied, last }
  }

  // ================= 撤销 / 重做 =================

  undo(): void {
    const cp = this.undoStack.pop()
    if (!cp) return
    this.redoStack.push({ doc: this.doc!, label: cp.label, t: this.clock() })
    this.kv.set(STORAGE_KEYS.doc, JSON.stringify(cp.doc))
    this.doc = cp.doc
    this.log('info', `撤销：${cp.label}，回退到 v${cp.doc.state.version}`)
  }

  redo(): void {
    const cp = this.redoStack.pop()
    if (!cp || !this.doc) return
    this.undoStack.push({ doc: this.doc, label: cp.label, t: this.clock() })
    this.kv.set(STORAGE_KEYS.doc, JSON.stringify(cp.doc))
    this.doc = cp.doc
    this.log('info', `重做：恢复到 v${cp.doc.state.version}`)
  }

  // ================= 场景装载 / 重置 =================

  loadSeed(kind: 'v1' | 'v3' | 'future' | 'corrupt'): void {
    this.faults.clear()
    this.dead = false
    this.undoStack = []
    this.redoStack = []
    this.kv.remove(STORAGE_KEYS.staging)
    this.kv.remove(STORAGE_KEYS.rollback)
    this.rollback = null
    let raw: string
    switch (kind) {
      case 'v1':
        raw = JSON.stringify(this.envelope(factoryV1()))
        break
      case 'v3':
        raw = JSON.stringify(this.envelope(factoryV3()))
        break
      case 'future':
        // 未来客户端写的是裸结构、不带本版信封
        raw = JSON.stringify(futureV7())
        break
      case 'corrupt':
        raw = truncateJson(JSON.stringify(this.envelope(factoryV3())))
        break
    }
    this.kv.set(STORAGE_KEYS.doc, raw)
    this.log('info', `已装载场景数据：${kind}`)
    this.loadDoc()
    this.staging = null
  }

  /** 从外部把当前主快照写坏（模拟其他程序/磁盘问题），刷新后应被隔离 */
  corruptMainSnapshot(): void {
    if (!this.doc) return
    this.kv.set(STORAGE_KEYS.doc, truncateJson(JSON.stringify(this.doc)))
    this.log('warn', '已将主快照写为半截数据，点击"刷新恢复"观察隔离')
    this.dead = true
  }

  reset(): void {
    this.kv.remove(STORAGE_KEYS.doc)
    this.kv.remove(STORAGE_KEYS.staging)
    this.kv.remove(STORAGE_KEYS.meta)
    this.kv.remove(STORAGE_KEYS.rollback)
    this.faults.clear()
    this.dead = false
    this.undoStack = []
    this.redoStack = []
    this.doc = null
    this.rawFuture = null
    this.mode = 'normal'
    this.status = 'empty'
    this.loadError = null
    this.staging = null
    this.quarantine = []
    this.rollback = null
    this.logs = []
    this.logSeq = 0
    this.log('info', '已重置全部本地数据')
  }

  private envelope(state: VaultState): VaultDoc {
    return { envelope: 1, state, updatedAt: this.clock() }
  }

  // ================= 隔离区 =================

  private sendToQuarantine(
    reason: QuarantineReason,
    source: 'main-snapshot' | 'migration-output',
    detail: string,
    raw: unknown,
    issues?: ValidationIssue[],
    stepId?: string,
  ): void {
    // 去重：同一份坏数据可能在多次刷新时被反复读到，只隔离一次，绝不覆盖已隔离内容
    const fingerprint = stableStringify(raw)
    if (
      this.quarantine.some(
        (q) => q.reason === reason && q.source === source && q.stepId === stepId && stableStringify(q.raw) === fingerprint,
      )
    ) {
      return
    }
    const item: QuarantineItem = {
      id: `q-${this.clock()}-${this.quarantine.length + 1}`,
      reason,
      source,
      capturedAt: this.clock(),
      detail,
      raw,
      ...(issues ? { issues } : {}),
      ...(stepId ? { stepId } : {}),
    }
    this.quarantine = [...this.quarantine, item]
    this.persistMeta()
  }

  /** 隔离区数据永不覆盖；仅允许显式清空 */
  clearQuarantine(): void {
    this.quarantine = []
    this.persistMeta()
    this.log('info', '已手动清空隔离区')
  }

  /** 用回滚快照恢复主快照。隔离区保持不动，坏数据仍可事后检查。 */
  restoreRollback(): { ok: boolean; reason?: string } {
    if (!this.rollback) return { ok: false, reason: '没有可用的回滚快照' }
    if (validateSnapshot(this.rollback.doc.state).length > 0) {
      return { ok: false, reason: '回滚快照校验未通过' }
    }
    this.kv.set(STORAGE_KEYS.doc, JSON.stringify(this.rollback.doc))
    this.kv.remove(STORAGE_KEYS.staging)
    this.staging = null
    this.dead = false
    this.undoStack = []
    this.redoStack = []
    const v = this.rollback.doc.state.version
    this.log('success', `已用回滚快照恢复主快照到 v${v}；隔离区中的坏数据保留未动`)
    this.loadDoc()
    return { ok: true }
  }

  // ================= 日志 =================

  private log(level: LogLevel, message: string, stepId?: string): void {
    this.logSeq += 1
    const entry: LogEntry = { id: this.logSeq, t: this.clock(), level, message, ...(stepId ? { stepId } : {}) }
    this.logs = [...this.logs, entry].slice(-300)
    this.persistMeta()
  }

  // ================= 视图 =================

  getView(): EngineView {
    return {
      status: this.status,
      mode: this.mode,
      version: this.doc ? this.doc.state.version : this.mode === 'future-readonly' ? this.versionOf(this.rawFuture) : null,
      state: this.doc ? this.doc.state : null,
      rawFuture: this.rawFuture,
      loadError: this.loadError,
      doc: this.doc,
      staging: this.staging ?? this.readStagingForView(),
      quarantine: this.quarantine,
      logs: this.logs,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      dead: this.dead,
      plan: this.currentPlan(),
      faults: this.faults.snapshot(),
      rollback: this.rollback,
    }
  }

  private readStagingForView(): StagingRecord | null {
    const raw = this.kv.get(STORAGE_KEYS.staging)
    if (!raw) return null
    try {
      return JSON.parse(raw) as StagingRecord
    } catch {
      return null
    }
  }

  static get allSteps(): MigrationStep[] {
    return allMigrations
  }

  static get latestVersion(): number {
    return LATEST_VERSION
  }

  static get migrationByFrom(): Map<number, MigrationStep> {
    return migrationByFrom
  }
}

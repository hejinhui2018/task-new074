/**
 * StateVault 验收测试 —— 在内存 KV 上直接跑迁移引擎。
 * 运行：npm test   （node --experimental-strip-types tests/run.ts）
 *
 * 覆盖：跨多版 / 幂等重跑 / 中途失败隔离 / 转换前断电 / 提交后断电 /
 *       主快照写坏与回滚恢复 / 未来版本降级只读 / 刷新恢复 / 撤销重做。
 */
import { MigrationEngine } from '../src/engine/vault.ts'
import { MemoryKV, STORAGE_KEYS } from '../src/engine/storage.ts'
import { LATEST_VERSION, factoryV1 } from '../src/engine/states.ts'
import type { VaultState, V5State, V2State, V3State, V4State } from '../src/engine/states.ts'

let passed = 0
let failed = 0
const failures: string[] = []

function ok(cond: boolean, message: string): void {
  if (cond) {
    passed += 1
  } else {
    failed += 1
    failures.push(message)
    console.error(`  ✗ ${message}`)
  }
}

function eq<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  ok(a === e, `${message}（期望 ${e}，实际 ${a}）`)
}

function section(name: string): void {
  console.log(`\n▌ ${name}`)
}

// 确定性时钟，便于断言
function makeClock(): () => string {
  let n = 0
  return () => {
    n += 1
    return `2026-01-01T00:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`
  }
}

/** 模拟"关掉标签页重开"：同一个 KV，全新引擎实例 */
function reopen(kv: MemoryKV): MigrationEngine {
  const engine = new MigrationEngine(kv, makeClock())
  engine.boot()
  return engine
}

function stateOf(engine: MigrationEngine): VaultState {
  const s = engine.getView().state
  if (!s) throw new Error('expected state present')
  return s
}

// ---------------------------------------------------------------------------
section('1. 跨多版迁移：v1（含脏 theme）一路到 v5')
{
  const engine = new MigrationEngine(new MemoryKV(), makeClock())
  engine.boot()
  engine.loadSeed('v1')
  eq(engine.getView().version, 1, '装载后为 v1')

  const v1 = stateOf(engine)
  eq((v1 as ReturnType<typeof factoryV1>).theme, 'blue', 'v1 原始脏 theme 是 blue')

  const { applied, last } = engine.runUntil()
  eq(applied, 4, '共执行 4 步')
  ok(last.kind === 'applied', '最后一步成功提交')
  eq(engine.getView().version, LATEST_VERSION, '到达最新版 v5')

  const v5 = stateOf(engine) as V5State
  eq(v5.theme, 'light', '脏 theme 已归一化为 light')
  eq(v5.profile.locale, 'zh-CN', 'v5 补齐 locale')
  ok(Object.values(v5.tasks).every((t) => Array.isArray(t.tags)), '所有任务都有 tags 数组')
  ok(Object.values(v5.tasks).every((t) => ['low', 'normal', 'high'].includes(t.priority)), '所有任务都有 priority')
  ok(v5.tasks['t-1001'] !== undefined, '任务 id 索引保留 t-1001')
  eq(v5.tasks['t-1001']?.order, 1000, '数组时代的 order 一路保留')
  eq(v5.profile.avatar, '林', 'avatar 由名字首字生成')
  ok(engine.getView().staging === null, '完成后无残留暂存日志')
  ok(engine.getView().rollback !== null, '存在回滚快照')
}

// ---------------------------------------------------------------------------
section('2. 幂等：同一迁移重跑不会重复应用')
{
  const engine = new MigrationEngine(new MemoryKV(), makeClock())
  engine.boot()
  engine.loadSeed('v1')
  engine.runUntil()

  const before = JSON.stringify(stateOf(engine))
  const again = engine.runUntil()
  eq(again.applied, 0, '再次运行不执行任何步骤')
  ok(again.last.kind === 'skipped', '返回 skipped')
  eq(JSON.stringify(stateOf(engine)), before, '状态完全不变')

  const step = engine.applyStep()
  ok(step.kind === 'skipped', '手动单步也被跳过')

  // 撤销一步后重跑 4->5：结果应与首次一致（重复运行安全）
  engine.undo()
  eq(engine.getView().version, 4, '撤销回到 v4')
  const rerun = engine.applyStep()
  ok(rerun.kind === 'applied', '重跑 4->5 成功')
  eq(engine.getView().version, 5, '重新到达 v5')
  const v5 = stateOf(engine) as V5State
  ok(Object.values(v5.tasks).every((t) => Array.isArray(t.tags)), '重跑后 tags 结构正确，未叠加/重复')
}

// ---------------------------------------------------------------------------
section('3. 中途失败：2->3 产物校验失败 → 半成品隔离，主快照不动，可续跑')
{
  const engine = new MigrationEngine(new MemoryKV(), makeClock())
  engine.boot()
  engine.loadSeed('v1')

  eq(engine.applyStep().kind, 'applied', '1->2 成功')
  eq(engine.getView().version, 2, '主快照为 v2')

  engine.faults.set('2->3', 'badOutput', 1)
  const result = engine.applyStep()
  ok(result.kind === 'failed', '2->3 被拦截为 failed')
  if (result.kind === 'failed') ok(result.issues.length > 0, '附带校验问题清单')

  const view = engine.getView()
  eq(view.version, 2, '主快照仍停在 v2（半新半旧不会发生）')
  ok(view.staging === null, '失败后暂存日志已清理')
  eq(view.quarantine.length, 1, '隔离区有 1 份半成品')
  const q = view.quarantine[0]!
  eq(q.source, 'migration-output', '隔离物来自迁移产物')
  eq(q.stepId, '2->3', '标记了步骤')
  const quarantined = q.raw as Partial<V3State>
  const firstTask = Object.values(quarantined.tasks as Record<string, { createdAt?: string }>)[0]!
  ok(firstTask.createdAt === undefined, '被隔离的确实是缺 createdAt 的坏产物')

  // 主快照自身仍可通过完整校验（没被坏产物覆盖）
  const main = stateOf(engine) as V2State
  ok(Array.isArray(main.panels) && main.panels.every((p) => typeof p.pinned === 'boolean'), '主快照 v2 结构完好')

  // 故障只触发一次：续跑成功
  const retry = engine.applyStep()
  ok(retry.kind === 'applied', '排除故障后重跑 2->3 成功')
  eq(engine.getView().version, 3, '前进到 v3')
  eq(engine.getView().quarantine.length, 1, '隔离区仍只有那 1 份，未被覆盖')

  engine.runUntil()
  eq(engine.getView().version, 5, '后续迁移一路到 v5')
}

// ---------------------------------------------------------------------------
section('4. 迁移函数抛异常：主快照与磁盘都保持干净')
{
  const engine = new MigrationEngine(new MemoryKV(), makeClock())
  engine.boot()
  engine.loadSeed('v1')
  engine.runUntil(2) // 到 v2
  engine.faults.set('2->3', 'transformThrow', 1)
  const result = engine.applyStep()
  ok(result.kind === 'failed', '判定为 failed')
  eq(engine.getView().version, 2, '版本仍是 v2')
  ok(engine.getView().staging === null, '暂存日志已清理')
  eq(engine.applyStep().kind, 'applied', '下一次执行成功')
}

// ---------------------------------------------------------------------------
section('5. 转换前断电：刷新后丢弃半成品，旧快照完好，可继续')
{
  const kv = new MemoryKV()
  let engine = new MigrationEngine(kv, makeClock())
  engine.boot()
  engine.loadSeed('v1')
  engine.runUntil(3) // 到 v3
  engine.faults.set('3->4', 'crashAfterStaging', 1)

  const crash = engine.applyStep()
  ok(crash.kind === 'crash', '返回 crash')
  ok(engine.getView().dead, '引擎死亡（标签页已崩）')
  ok(engine.applyStep().kind === 'skipped', '死亡状态下操作被锁定')
  eq(kv.get(STORAGE_KEYS.staging) !== null, true, '磁盘上确实留着 staged 暂存日志')

  // 用户重新打开工作台
  engine = reopen(kv)
  const view = engine.getView()
  eq(view.version, 3, '恢复后主快照仍是 v3')
  ok(view.staging === null, '暂存日志已按恢复流程清理')
  ok(view.logs.some((l) => l.message.includes('提交前中断')), '日志说明：提交前中断、丢弃半成品')

  engine.runUntil()
  eq(engine.getView().version, 5, '恢复后可继续迁移到 v5')
}

// ---------------------------------------------------------------------------
section('6. 提交后断电：刷新后识别"已提交"，迁移绝不重跑')
{
  const kv = new MemoryKV()
  let engine = new MigrationEngine(kv, makeClock())
  engine.boot()
  engine.loadSeed('v1')
  engine.runUntil(3) // 到 v3
  const snapshotBefore = JSON.stringify(stateOf(engine))
  engine.faults.set('3->4', 'crashAfterDocWrite', 1)

  const crash = engine.applyStep()
  ok(crash.kind === 'crash', '提交后断电')
  // 主快照已是 v4，但暂存日志还停在 staged
  const rawStaging = JSON.parse(kv.get(STORAGE_KEYS.staging)!) as { phase: string }
  eq(rawStaging.phase, 'staged', '崩溃瞬间暂存日志尚未标记 committed')

  engine = reopen(kv)
  eq(engine.getView().version, 4, '恢复后版本是 v4（提交确实落盘了）')
  ok(engine.getView().staging === null, '暂存日志被清理')
  ok(engine.getView().logs.some((l) => l.message.includes('不重复执行')), '日志明确：不重复执行迁移')

  // 关键幂等：v3 的输入状态没有被第二次转换（v4 上再跑 3->4 根本不在计划里）
  const v4 = stateOf(engine) as V4State
  eq(v4.version, 4, '没有被重复迁移')
  ok(Object.values(v4.tasks).every((t) => t.priority === 'normal'), 'priority 只补了一次')
  // v3 之前的状态也完好（回滚快照保留）
  ok(engine.getView().rollback?.doc.state.version === 3, '回滚快照指向 v3')
  void snapshotBefore

  engine.applyStep()
  eq(engine.getView().version, 5, '继续 4->5 正常')
}

// ---------------------------------------------------------------------------
section('7. 主快照写坏：刷新即隔离，回滚恢复不覆盖坏数据')
{
  const kv = new MemoryKV()
  let engine = new MigrationEngine(kv, makeClock())
  engine.boot()
  engine.loadSeed('v1')
  engine.runUntil(3) // 到 v3，回滚快照是 v2
  engine.corruptMainSnapshot()
  let docIsBadJson = false
  try {
    JSON.parse(kv.get(STORAGE_KEYS.doc)!)
  } catch {
    docIsBadJson = true
  }
  ok(docIsBadJson, '磁盘上的主快照确实不是合法 JSON')

  engine = reopen(kv)
  const view1 = engine.getView()
  eq(view1.status, 'quarantined', '启动后状态为已隔离')
  ok(view1.state === null, '不把坏数据当成状态加载')
  eq(view1.quarantine.length, 1, '坏主快照进入隔离区')
  eq(view1.quarantine[0]?.reason, 'corrupted', '原因是 corrupted')
  eq(view1.rollback?.doc.state.version, 2, '回滚快照仍是完好的 v2')

  // 再刷新一次：去重，不应产生第二份隔离
  engine = reopen(kv)
  eq(engine.getView().quarantine.length, 1, '重复刷新不重复隔离')

  const restored = engine.restoreRollback()
  ok(restored.ok, '回滚恢复成功')
  const view2 = engine.getView()
  eq(view2.version, 2, '主快照恢复为 v2')
  eq(view2.status, 'ok', '恢复后状态正常可读写')
  eq(view2.quarantine.length, 1, '隔离区中的坏数据原样保留，未被覆盖')
  ok(typeof view2.quarantine[0]?.raw === 'string', '隔离区保留的是坏快照原文')

  engine.runUntil()
  eq(engine.getView().version, 5, '从 v2 重新迁移成功')
}

// ---------------------------------------------------------------------------
section('8. 未来版本 v7：降级只读，任何迁移都不碰它')
{
  const kv = new MemoryKV()
  let engine = new MigrationEngine(kv, makeClock())
  engine.boot()
  engine.loadSeed('future')
  const rawOnDisk = kv.get(STORAGE_KEYS.doc)

  const view = engine.getView()
  eq(view.version, 7, '识别出 v7')
  eq(view.mode, 'future-readonly', '进入降级只读模式')
  ok(view.state === null, '不按已知结构解析')
  ok((view.rawFuture as { quantumLayout?: unknown }).quantumLayout !== undefined, '未来字段原样可见')

  ok(engine.applyStep().kind === 'skipped', '单步迁移被拒绝')
  ok(engine.runUntil().applied === 0, '自动运行也不执行')
  eq(kv.get(STORAGE_KEYS.doc), rawOnDisk, '磁盘数据一个字节都没变')

  // 刷新后依然只读
  engine = reopen(kv)
  eq(engine.getView().mode, 'future-readonly', '刷新后仍为只读')
}

// ---------------------------------------------------------------------------
section('9. 启动即损坏 / 无回滚快照：安全失败而不是抛白屏')
{
  const kv = new MemoryKV()
  const engine = new MigrationEngine(kv, makeClock())
  engine.boot()
  engine.loadSeed('corrupt')
  // loadSeed 装载后视图仍会尝试加载；手动按"刷新"路径走一遍
  const reopened = reopen(kv)
  const view = reopened.getView()
  eq(view.status, 'quarantined', '半截 JSON 启动即隔离')
  ok(view.rollback === null, '没有回滚快照可恢复（如实告知）')
  eq(view.quarantine.length, 1, '坏数据已隔离')
  ok(reopened.restoreRollback().ok === false, '恢复请求被安全拒绝')
}

// ---------------------------------------------------------------------------
section('10. 撤销 / 重做')
{
  const engine = new MigrationEngine(new MemoryKV(), makeClock())
  engine.boot()
  engine.loadSeed('v3')
  engine.runUntil()
  eq(engine.getView().version, 5, 'v3 → v5')

  engine.undo()
  eq(engine.getView().version, 4, '撤销一步到 v4')
  engine.undo()
  eq(engine.getView().version, 3, '再撤销到 v3')
  const v3 = stateOf(engine) as V3State
  ok(!('emailVerified' in v3.profile), '撤销后确实是 v3 结构')

  engine.redo()
  eq(engine.getView().version, 4, '重做到 v4')
  engine.redo()
  eq(engine.getView().version, 5, '重做到 v5')
  ok(engine.redo() === undefined, '重做栈到底')
}

// ---------------------------------------------------------------------------
section('11. v3 老用户跨 2 版 + 重置')
{
  const engine = new MigrationEngine(new MemoryKV(), makeClock())
  engine.boot()
  engine.loadSeed('v3')
  const { applied } = engine.runUntil()
  eq(applied, 2, '执行 2 步')
  const v5 = stateOf(engine) as V5State
  ok(v5.tasks['t-2001']?.tags !== undefined, '老任务补齐 tags')
  eq(v5.layout.density, 'comfortable', '补齐 density')

  engine.reset()
  const view = engine.getView()
  eq(view.status, 'empty', '重置后无快照')
  eq(view.quarantine.length, 0, '隔离区清空')
  ok(view.rollback === null, '回滚快照清空')
}

// ---------------------------------------------------------------------------
section('12. 隔离区永不覆盖：相同坏产物去重，不同坏数据各自留档')
{
  // 固定时钟：让两次失败的产物字节级一致，验证指纹去重
  const engine = new MigrationEngine(new MemoryKV(), () => '2026-01-01T00:00:00.000Z')
  engine.boot()
  engine.loadSeed('v1')
  engine.applyStep() // 1->2
  engine.faults.set('2->3', 'badOutput', 1)
  engine.applyStep() // 失败 #1
  engine.faults.set('2->3', 'badOutput', 1)
  engine.applyStep() // 字节级相同的失败 #2
  eq(engine.getView().quarantine.length, 1, '相同坏产物只隔离一次')
}

// ---------------------------------------------------------------------------
console.log(`\n${'=' .repeat(60)}`)
if (failed === 0) {
  console.log(`✅ 全部通过：${passed} 个断言`)
  process.exit(0)
} else {
  console.error(`❌ ${failed} 个失败 / ${passed} 个通过`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

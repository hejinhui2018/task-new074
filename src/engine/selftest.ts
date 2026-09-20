/**
 * 引擎自测（node 下运行，不打包进前端）：
 *   npx esbuild src/engine/selftest.ts --bundle --platform=node --format=esm | node
 */
import { VaultEngine, seedState } from './engine';
import { StorageLike, VaultStorage } from './storage';
import { VaultEnvelope } from './types';

class MemStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  readEnvelope(): VaultEnvelope {
    return JSON.parse(this.getItem('statevault.envelope.v1')) as VaultEnvelope;
  }
}

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}
function v(s: unknown) {
  return (s as { version?: number }).version ?? 0;
}

/* 1. 跨多版全量迁移 + 幂等重跑 */
function testFullPath() {
  console.log('① 跨多版 v0 → v5 + 重复运行');
  const store = new MemStorage();
  const e = make(store, 1_700_000_000_000);
  assert(v(e.getSnapshot().live) === 0, '初始 live = v0');
  e.beginRun({ auto: false });
  for (let i = 0; i < 5; i++) e.tick();
  assert(v(e.getSnapshot().live) === 5, '5 步后 live = v5');
  assert(e.getSnapshot().pending === null, 'pending 已清空');
  const live = e.getSnapshot().live as Record<string, unknown>;
  assert(Array.isArray(live.order) && (live.order as unknown[]).length === 2, 'v5 order 含 2 个任务');
  assert(!Array.isArray(live.tasks) && typeof live.tasks === 'object', 'v5 tasks 为字典');
  const records = e.getSnapshot().lastRun?.records ?? {};
  assert(Object.values(records).every((r) => r.status === 'applied'), '5 条记录全部 applied');

  // 重复运行：不能重复应用
  e.beginRun({ auto: false });
  const run2 = e.getSnapshot().lastRun!;
  assert(run2.records && Object.keys(run2.records).length === 0, '已是最新，二次运行没有执行任何迁移');
  assert(v(e.getSnapshot().live) === 5, '重复运行后版本仍为 v5');

  // 撤销/重做
  e.undo();
  assert(v(e.getSnapshot().live) === 4, '撤销一步 → v4');
  e.undo();
  assert(v(e.getSnapshot().live) === 3, '撤销两步 → v3');
  e.redo();
  assert(v(e.getSnapshot().live) === 4, '重做一步 → v4');
}

/* 2. 中途失败：半成品隔离，live 与原快照不被覆盖 */
function testMidFailure() {
  console.log('② 中途失败（2->3 注入损坏数据）');
  const store = new MemStorage();
  const e = make(store, 1_700_000_000_000);
  e.beginRun({ auto: false, fault: { stepId: '2->3', kind: 'corrupt' } });
  e.tick();
  e.tick();
  const rec = e.tick(); // 2->3 失败
  assert(rec?.status === 'failed', '2->3 记录为 failed');
  assert(v(e.getSnapshot().live) === 2, 'live 回滚保持 v2');
  assert(e.getSnapshot().quarantine.length === 1, '隔离区有 1 条半成品');
  const q = e.getSnapshot().quarantine[0];
  assert(q.source === 'migration' && q.stage === 'validate' && q.migrationId === '2->3', '隔离项标记为 migration/validate/2->3');
  assert((q.payload as { version: number }).version === 3, '隔离的是 v3 半成品而非原 v2');
  assert(e.getSnapshot().snapshots.some((s) => v(s.state) === 2), '回滚快照保留了 v2 原状');
  assert(e.getSnapshot().pending === null, '失败后 run 中止，pending 清空');

  // 修复后重跑：不跳过（版本仍是 2），且不带故障时应成功
  e.beginRun({ auto: false });
  let ok = true;
  for (let i = 0; i < 3; i++) ok = !!e.tick();
  assert(ok && v(e.getSnapshot().live) === 5, '清掉故障重跑：v2 → v5 成功');
}

/* 3. transform 抛错 */
function testThrowFault() {
  console.log('③ transform 阶段抛异常');
  const store = new MemStorage();
  const e = make(store, 1_700_000_000_000);
  e.beginRun({ auto: false, fault: { stepId: '0->1', kind: 'throw' } });
  const rec = e.tick();
  assert(rec?.status === 'faulted' && rec.stage === 'transform', '0->1 记录为 faulted/transform');
  assert(v(e.getSnapshot().live) === 0, 'live 保持 v0');
  assert(e.getSnapshot().quarantine.length === 1, '异常现场已隔离');
}

/* 4. 迁移中途“刷新”：pending 持久化，恢复后继续，且不重复应用 */
function testInterruptedResume() {
  console.log('④ 中途刷新 → 恢复 → 继续');
  const store = new MemStorage();
  const e1 = make(store, 1_700_000_000_000);
  e1.beginRun({ auto: false });
  e1.tick();
  e1.tick(); // 已提交到 v2，下一步 2->3 未执行
  assert(v(store.readEnvelope().live) === 2, '落盘 live = v2');
  assert(store.readEnvelope().pending?.nextIndex === 2, 'pending.nextIndex = 2 已落盘');

  // 刷新：同 storage 新引擎
  const e2 = make(store, 1_700_000_001_000);
  assert(!!e2.getSnapshot().recovery.interrupted, '恢复时报告中断');
  assert(v(e2.getSnapshot().live) === 2, '恢复后 live 仍为 v2（无半新半旧）');
  e2.beginRun({ auto: false }); // 沿用 pending
  for (let i = 0; i < 3; i++) e2.tick();
  assert(v(e2.getSnapshot().live) === 5, '从中断处继续到 v5');
  assert(e2.getSnapshot().pending === null, '继续完成后 pending 清空');
}

/* 5. 存储损坏：原文隔离，不覆盖 */
function testStorageCorrupt() {
  console.log('⑤ 存储损坏恢复');
  const store = new MemStorage();
  store.setItem('statevault.envelope.v1', '{ broken json');
  const e = make(store, 1_700_000_000_000);
  assert(!!e.getSnapshot().recovery.storageFault, '报告 storageFault');
  assert(e.getSnapshot().quarantine[0]?.raw === '{ broken json', '损坏原文完整隔离');
  assert(v(e.getSnapshot().live) === 0, '载入安全 v0 示例');
  // 落盘后原损坏串已被新信封替换（隔离区里仍保留原文）
  const env = store.readEnvelope();
  assert(env.format === 'statevault', '新存档为合法信封');
  assert(env.quarantine[0]?.raw === '{ broken json', '信封隔离区仍保留损坏原文');
}

/* 6. 降级读取：未来版本只读 */
function testFutureVersion() {
  console.log('⑥ 降级读取 v6');
  const store = new MemStorage();
  const e1 = make(store, 1_700_000_000_000);
  e1.writeFutureEnvelope();
  const e2 = make(store, 1_700_000_001_000);
  assert(e2.getSnapshot().readOnly === true, '未来版本进入只读模式');
  assert(v(e2.getSnapshot().live) === 6, 'v6 数据原样保留');
  e2.beginRun({ auto: false });
  assert(e2.getSnapshot().pending === null, '只读模式下不允许迁移');
}

/* 7. 刷新恢复后重复 tick 不重复应用（skip 分支） */
function testSkipSemantics() {
  console.log('⑦ 版本领先于计划步骤 → 跳过不重复应用');
  const store = new MemStorage();
  const e1 = make(store, 1_700_000_000_000);
  e1.beginRun({ auto: false });
  e1.tick();
  e1.tick();
  e1.tick(); // v3 已应用
  const e2 = make(store, 1_700_000_000_001);
  // 手动构造一个从头开始的 pending（模拟计划异常重复）
  e2.beginRun({ auto: false }); // 恢复的 pending 从 2->3 开始，正常
  e2.abortPending();
  assert(v(e2.getSnapshot().live) === 3, '放弃计划后 live 仍为 v3');
  e2.beginRun({ auto: false });
  const run = e2.getSnapshot().lastRun!;
  assert(run.fromVersion === 3 && run.targetVersion === 5, '新计划只含 3->4, 4->5');
}

function make(store: MemStorage, t0: number): VaultEngine {
  let t = t0;
  const storage = new VaultStorage(store);
  return new VaultEngine(storage, () => (t += 7));
}

void seedState;

try {
  testFullPath();
  testMidFailure();
  testThrowFault();
  testInterruptedResume();
  testStorageCorrupt();
  testFutureVersion();
  testSkipSemantics();
  console.log(`\n结果：${passed} 通过，${failed} 失败`);
  if (failed) process.exit(1);
} catch (e) {
  console.error('自测崩溃：', e);
  process.exit(1);
}

import { MIGRATIONS } from '../engine/migrations';
import { AnyState, FaultKind, PendingRun, StepRecord, StepStatus } from '../engine/types';
import { StepStatusBadge } from './ui';

type Derived =
  | { kind: 'record'; status: StepStatus; record: StepRecord; active: boolean }
  | { kind: 'active'; auto: boolean }
  | { kind: 'pending'; locked: boolean };

function derive(
  index: number,
  liveVersion: number,
  pending: PendingRun | null,
  records: Record<string, StepRecord>,
): Derived {
  const m = MIGRATIONS[index];
  if (pending) {
    if (index < pending.nextIndex) {
      const r = records[m.id];
      return { kind: 'record', status: r?.status ?? 'applied', record: r ?? emptyRec(m.id), active: false };
    }
    if (index === pending.nextIndex) return { kind: 'active', auto: pending.auto };
    return { kind: 'pending', locked: true };
  }
  const r = records[m.id];
  if (r) return { kind: 'record', status: r.status, record: r, active: false };
  if (liveVersion >= m.to) return { kind: 'record', status: 'applied', record: emptyRec(m.id), active: false };
  if (liveVersion === m.from) return { kind: 'pending', locked: false };
  return { kind: 'pending', locked: true };
}

function emptyRec(id: string): StepRecord {
  return { id, status: 'pending', startedAt: 0, durationMs: 0 };
}

export function MigrationSteps({
  liveVersion,
  pending,
  records,
}: {
  liveVersion: number;
  pending: PendingRun | null;
  records: Record<string, StepRecord>;
  live: AnyState;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>迁移步骤流水线</h2>
        <span className="hint">每步 = 前置快照 → 副本上变更 → 校验 → 原子提交；失败则回滚并隔离半成品</span>
      </div>
      <div className="steps">
        {MIGRATIONS.map((m, i) => {
          const d = derive(i, liveVersion, pending, records);
          const isActive = d.kind === 'active';
          const isFailed = d.kind === 'record' && (d.status === 'failed' || d.status === 'faulted');
          const isDone =
            d.kind === 'record' && (d.status === 'applied' || d.status === 'skipped');
          const reverted =
            d.kind === 'record' && d.status === 'applied' && liveVersion <= m.from && !pending;

          return (
            <div
              key={m.id}
              className={`step ${isActive ? 'is-active' : ''} ${isFailed ? 'is-failed' : ''} ${
                isDone && !reverted ? 'is-done' : ''
              }`}
            >
              <div className="step-num">
                #{i + 1}
                <span className="fromto">
                  v{m.from}→v{m.to}
                </span>
              </div>

              <div>
                <div className="step-title">{m.title}</div>
                <div className="step-meta">
                  <div className="meta-block">
                    <div className="meta-label">① 输入版本 / 变更</div>
                    <ul>
                      <li>
                        输入：<b>v{m.from}</b> 文档，输出：<b>v{m.to}</b>
                      </li>
                      {m.changes.map((c, k) => (
                        <li key={k}>{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="meta-block">
                    <div className="meta-label">② 提交前校验规则</div>
                    <ul>
                      {m.validationRules.map((c, k) => (
                        <li key={k}>{c}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="meta-block impact">
                    <div className="meta-label">③ 失败影响（回滚保证）</div>
                    <div className="meta-text">↩ {m.failureImpact}</div>
                  </div>

                  {d.kind === 'record' && d.record.validation && !d.record.validation.ok && (
                    <div className="meta-block impact">
                      <div className="meta-label">本次校验拦截到的问题</div>
                      <div className="meta-text">
                        {d.record.validation.errors.map((e, k) => (
                          <div key={k}>· {e}</div>
                        ))}
                      </div>
                    </div>
                  )}
                  {d.kind === 'record' && (d.status === 'faulted' || d.status === 'failed') && d.record.note && (
                    <div className="meta-block impact">
                      <div className="meta-label">现场记录</div>
                      <div className="meta-text">
                        阶段：{d.record.stage ?? '—'} · {d.record.note}
                        {d.record.durationMs > 0 && <> · 耗时 {d.record.durationMs}ms</>}
                      </div>
                    </div>
                  )}
                  {reverted && (
                    <div className="meta-block impact">
                      <div className="meta-label">注意</div>
                      <div className="meta-text" style={{ color: '#e8c178', borderColor: 'rgba(217,164,65,.3)', background: 'rgba(217,164,65,.07)' }}>
                        本步曾应用成功，但撤销 / 回滚后 live 已退回 v{m.from}。版本号为闸门：不会被重复应用。
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="step-right">
                {d.kind === 'active' && (
                  <span className={`badge badge-${d.auto ? 'running' : 'warn'}`}>
                    {d.auto ? (
                      <>
                        <span className="spinner" /> 执行中
                      </>
                    ) : (
                      '▶ 下一步'
                    )}
                  </span>
                )}
                {d.kind === 'pending' && (
                  <span className="badge badge-pending">{d.locked ? '🔒 排队中' : '待执行'}</span>
                )}
                {d.kind === 'record' && <StepStatusBadge status={d.status} />}
                {d.kind === 'record' && d.status === 'applied' && d.record.durationMs > 0 && (
                  <span className="hint" style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                    {d.record.durationMs}ms
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { FaultKind };

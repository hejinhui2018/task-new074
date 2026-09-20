import type { EngineView } from '../engine/vault'
import { allMigrations, stepId } from '../engine/migrations'
import { FAULT_LABELS, type FaultKind } from '../engine/faults'
import type { StepTrace, Traces } from '../hooks/useVault'

const FAULT_OPTIONS: FaultKind[] = [
  'transformThrow',
  'badOutput',
  'crashAfterStaging',
  'crashAfterDocWrite',
  'corruptDocWrite',
]

interface Props {
  view: EngineView
  traces: Traces
  onSetFault: (id: string, kind: FaultKind | null, repeat: number) => void
}

type CardState = 'done' | 'fail' | 'crash' | 'next' | 'idle'

const STATE_TEXT: Record<CardState, string> = {
  done: '已提交',
  fail: '已拦截',
  crash: '断电',
  next: '待执行',
  idle: '未到达',
}

export function Pipeline({ view, traces, onSetFault }: Props) {
  const currentVersion = view.version ?? 0

  return (
    <div className="panel">
      <div className="panel-hd">
        迁移流水线
        <span className="hint">
          每张卡片展示：输入版本 → 变更内容 → 提交前校验 → 失败影响。重跑同一迁移不会重复应用（版本号 + 暂存日志双重幂等）。
        </span>
      </div>
      <div className="panel-bd">
        <div className="pipeline">
          {allMigrations.map((m) => {
            const id = stepId(m.from, m.to)
            const trace: StepTrace = traces[id] ?? { status: 'idle' }
            let state: CardState = 'idle'
            if (trace.status === 'applied') state = 'done'
            else if (trace.status === 'failed') state = 'fail'
            else if (trace.status === 'crashed') state = 'crash'
            else if (currentVersion === m.from) state = 'next'
            else if (currentVersion >= m.to) state = 'done'

            const activeFault = view.faults[id]
            const armable =
              view.status === 'ok' && view.mode === 'normal' && !view.dead && currentVersion <= m.from

            return (
              <div key={id} className={`step-card state-${state === 'done' ? 'applied' : state === 'fail' ? 'failed' : state === 'crash' ? 'crashed' : state === 'next' ? 'next' : ''}`}>
                <div className="step-hd">
                  <span className="vfrom">v{m.from}</span>
                  <span className="chev">→</span>
                  <span className="vto">v{m.to}</span>
                  <span className={`state-tag ${state}`}>{STATE_TEXT[state]}</span>
                </div>
                <div className="step-bd">
                  <div className="step-title">{m.title}</div>

                  <div>
                    <div className="mini-label">数据变更</div>
                    <ul className="kv-list">
                      {m.changes.map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="mini-label">提交前校验（{m.outputChecks.length} 条）</div>
                    <ul className="kv-list checks">
                      {m.outputChecks.slice(0, 3).map((c, i) => (
                        <li key={i}>{c.description}</li>
                      ))}
                      {m.outputChecks.length > 3 && <li>…另 {m.outputChecks.length - 3} 条</li>}
                    </ul>
                  </div>

                  <ul className="kv-list impact">
                    <li>{m.failureImpact}</li>
                  </ul>

                  <div className="fault-row" title={armable ? '故障可提前挂到后续步骤，自动运行到达时触发（默认触发一次）' : '当前状态不可挂载故障'}>
                    <select
                      value={activeFault?.kind ?? ''}
                      disabled={!armable}
                      onChange={(e) => onSetFault(id, (e.target.value || null) as FaultKind | null, 1)}
                    >
                      <option value="">⚙️ 不注入故障</option>
                      {FAULT_OPTIONS.map((f) => (
                        <option key={f} value={f}>
                          {FAULT_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>
                  {activeFault && (
                    <div className="muted" style={{ marginTop: -6 }}>
                      已挂故障，剩余触发 {Number.isFinite(activeFault.remaining) ? `${activeFault.remaining} 次` : '每次'}
                      {trace.status === 'failed' && trace.detail ? `；${trace.detail}` : ''}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

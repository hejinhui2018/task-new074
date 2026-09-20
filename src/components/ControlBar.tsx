import { useState } from 'react';
import { LATEST_VERSION } from '../engine/types';
import { FaultKind } from '../engine/types';
import { VaultActions } from '../state/useVault';
import { Badge } from './ui';

const FAULT_STEP_OPTIONS = ['0->1', '1->2', '2->3', '3->4', '4->5'];

export function ControlBar({
  liveVersion,
  pending,
  readOnly,
  canUndo,
  canRedo,
  actions,
}: {
  liveVersion: number;
  pending: {
    plan: string[];
    nextIndex: number;
    auto: boolean;
    fault: { stepId: string; kind: FaultKind } | null;
  } | null;
  readOnly: boolean;
  canUndo: boolean;
  canRedo: boolean;
  actions: VaultActions;
}) {
  const [faultStep, setFaultStep] = useState('2->3');
  const [faultKind, setFaultKind] = useState<FaultKind>('corrupt');

  const running = !!pending;
  const currentStepId = pending ? pending.plan[pending.nextIndex] : null;
  const upcoming = pending ? pending.plan.slice(pending.nextIndex) : [];
  const armedStep = pending?.fault?.stepId ?? null;

  return (
    <div className="card">
      <div className="card-body">
        <div className="controlbar">
          <div className="ctl-group">
            <span className="version-flow">
              <span className="vchip">v{liveVersion}</span>
              <span className="arrow">→</span>
              <span className={`vchip ${liveVersion >= LATEST_VERSION ? 'vchip-live' : ''}`}>v{LATEST_VERSION}</span>
            </span>
            {pending && (
              <Badge tone={pending.auto ? 'running' : 'warn'}>
                {pending.auto ? (
                  <>
                    <span className="spinner" /> 自动运行中
                  </>
                ) : (
                  '已暂停 / 单步'
                )}
              </Badge>
            )}
            {readOnly && <Badge tone="readonly">只读模式</Badge>}
          </div>

          <div className="ctl-group">
            {!running ? (
              <>
                <button className="btn btn-primary" disabled={readOnly} onClick={() => actions.startAuto(null)}>
                  ▶ 自动迁移
                </button>
                <button className="btn" disabled={readOnly} onClick={() => actions.stepOnce(null)}>
                  单步
                </button>
              </>
            ) : (
              <>
                <button className="btn btn-primary" disabled={!pending || pending.auto} onClick={actions.resume}>
                  ▶ 继续
                </button>
                <button className="btn" disabled={!pending || !pending.auto} onClick={actions.pause}>
                  ⏸ 暂停
                </button>
                <button className="btn" disabled={pending.auto} onClick={() => actions.stepOnce(null)}>
                  单步
                </button>
                <button className="btn btn-danger" onClick={actions.abortPending}>
                  终止计划
                </button>
              </>
            )}
          </div>

          <div className="ctl-group">
            <button className="btn btn-sm" disabled={!canUndo} onClick={actions.undo} title="撤销上一次状态变更">
              ↶ 撤销
            </button>
            <button className="btn btn-sm" disabled={!canRedo} onClick={actions.redo}>
              ↷ 重做
            </button>
            <button className="btn btn-sm" onClick={actions.reload} title="整页刷新，从 localStorage 恢复">
              🔄 刷新恢复
            </button>
          </div>
        </div>

        {/* 故障注入行 */}
        <div className="controlbar" style={{ marginTop: 10 }}>
          <div className="ctl-group">
            <span className="ctl-label">故障注入</span>
            <select value={faultStep} onChange={(e) => setFaultStep(e.target.value)} disabled={readOnly}>
              {FAULT_STEP_OPTIONS.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
            <select value={faultKind} onChange={(e) => setFaultKind(e.target.value as FaultKind)} disabled={readOnly}>
              <option value="corrupt">生成损坏半成品（被校验拦截）</option>
              <option value="throw">transform 抛异常</option>
            </select>
            {!running ? (
              <>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={readOnly}
                  onClick={() => actions.startAuto({ stepId: faultStep, kind: faultKind })}
                  title="建立计划并自动运行，到选定步骤时触发一次故障；已是最新版本时为无操作（幂等）"
                >
                  带故障自动运行
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  disabled={readOnly}
                  onClick={() => actions.stepOnce({ stepId: faultStep, kind: faultKind })}
                  title="单步执行；只有当选定步骤是下一步时故障才会触发"
                >
                  带故障单步
                </button>
              </>
            ) : (
              <button
                className="btn btn-danger btn-sm"
                disabled={pending.auto || upcoming.length === 0}
                onClick={() => actions.armFault(faultStep, faultKind)}
                title="暂停后可给尚未执行的某一步武装故障，再继续"
              >
                武装到 {faultStep}
              </button>
            )}
            {armedStep && <Badge tone="danger">已武装：{armedStep}</Badge>}
            {running && currentStepId && (
              <span className="hint" style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
                下一步：{currentStepId} · 剩余 {upcoming.length} 步
              </span>
            )}
          </div>

          <div className="ctl-group">
            <span className="ctl-label">重置为</span>
            {[0, 1, 2, 3, 4, 5].map((ver) => (
              <button key={ver} className="btn btn-sm" disabled={running || readOnly} onClick={() => actions.resetTo(ver)}>
                v{ver}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

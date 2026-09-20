import { RecoveryReport } from '../engine/types';

export function RecoveryBanner({
  recovery,
  readOnly,
  onContinue,
  onAbort,
  onDismiss,
  onReset,
}: {
  recovery: RecoveryReport;
  readOnly: boolean;
  onContinue: () => void;
  onAbort: () => void;
  onDismiss: () => void;
  onReset: () => void;
}) {
  if (readOnly && recovery.liveFault) {
    return (
      <div className="banner banner-danger">
        <div className="banner-icon">⛔</div>
        <div className="banner-body">
          <div className="banner-title">只读保护：{recovery.liveFault.reason}</div>
          <div className="banner-text">
            live 数据被原样保留，任何迁移 / 编辑操作都被拒绝，避免高版本数据被旧代码破坏。可重置为示例存档继续验收。
          </div>
          <div className="banner-actions">
            <button className="btn btn-danger btn-sm" onClick={onReset}>
              重置为 v0 示例
            </button>
            <button className="btn btn-ghost btn-sm" onClick={onDismiss}>
              仅关闭提示
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (recovery.storageFault) {
    return (
      <div className="banner banner-danger">
        <div className="banner-icon">🧺</div>
        <div className="banner-body">
          <div className="banner-title">本地存档损坏，原始数据已隔离（未覆盖）</div>
          <div className="banner-text">
            {recovery.storageFault.reason}。系统载入了安全的 v0 示例；损坏原文完整保留在隔离区，可复制出来排查。
          </div>
          <div className="banner-actions">
            <button className="btn btn-sm" onClick={onDismiss}>
              知道了
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (recovery.interrupted) {
    const p = recovery.interrupted;
    return (
      <div className="banner banner-warn">
        <div className="banner-icon">⚠️</div>
        <div className="banner-body">
          <div className="banner-title">
            检测到上次迁移中途中断（刷新 / 崩溃）：计划 {p.plan.join('、')}，已提交 {p.nextIndex} 步
          </div>
          <div className="banner-text">
            已提交的步骤保留在 live 中，没有半成品残留。可从第 {p.nextIndex + 1} 步（{p.plan[p.nextIndex]}）继续，
            或放弃计划保持当前版本。继续时已应用的步骤不会重复执行。
          </div>
          <div className="banner-actions">
            <button className="btn btn-primary btn-sm" onClick={onContinue}>
              从中断处继续
            </button>
            <button className="btn btn-sm" onClick={onAbort}>
              放弃计划
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

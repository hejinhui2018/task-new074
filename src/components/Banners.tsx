import type { EngineView } from '../engine/vault'

interface Props {
  view: EngineView
  running: boolean
  onRestoreRollback: () => void
}

export function Banners({ view, running, onRestoreRollback }: Props) {
  if (view.status === 'empty') {
    return (
      <div className="banner info">
        <span>🗄️</span>
        <span className="grow">
          本地没有任何快照。先在下方选择一个场景装载数据（推荐先试「跨 4 版：v1 老用户」）。
        </span>
      </div>
    )
  }

  if (view.status === 'quarantined') {
    return (
      <div className="banner err">
        <span>🛑</span>
        <span className="grow">
          <strong>主快照已隔离：</strong>
          {view.loadError}。原数据没有被覆盖，可在「隔离区」页签检查；
          {view.rollback ? '也可用回滚快照恢复到上一个完好版本。' : '当前没有更早的回滚快照。'}
        </span>
        {view.rollback && (
          <button className="btn tiny" onClick={onRestoreRollback}>
            用回滚快照恢复 v{view.rollback.doc.state.version}
          </button>
        )}
      </div>
    )
  }

  if (view.mode === 'future-readonly') {
    return (
      <div className="banner warn">
        <span>🔮</span>
        <span className="grow">
          <strong>降级只读模式：</strong>数据来自更新的客户端（v{String(view.version)}），
          当前客户端只支持到 v5。数据原样展示、禁止迁移和覆盖写入，避免新数据被旧结构吃掉。
        </span>
      </div>
    )
  }

  if (view.dead) {
    return (
      <div className="banner warn">
        <span>⚡</span>
        <span className="grow">
          <strong>进程已在迁移中断电终止。</strong>
          所有操作已锁定——真实世界里这对应标签页崩溃。点击「刷新恢复」模拟用户重新打开工作台：
          引擎会依据暂存日志判断提交是否完成，主快照不会被重复迁移。
        </span>
      </div>
    )
  }

  if (running) {
    return (
      <div className="banner info">
        <span>⏳</span>
        <span className="grow">
          自动迁移运行中：每一步都按「暂存日志 → 内存转换 → 产物校验 → 原子提交 → 清暂存」执行，可随时暂停。
        </span>
      </div>
    )
  }

  if (view.plan.length === 0) {
    return (
      <div className="banner info" style={{ borderColor: 'rgba(63,185,80,.4)', background: 'var(--green-soft)', color: '#7ee787' }}>
        <span>✅</span>
        <span className="grow">
          主快照已在最新版 v{view.version}，结构校验全部通过。可以尝试撤销、写坏数据后刷新、或重置后换场景。
        </span>
      </div>
    )
  }

  return (
    <div className="banner info">
      <span>🧭</span>
      <span className="grow">
        当前 v{view.version}，距最新 v5 还有 {view.plan.length} 步迁移
        {view.staging ? `，存在未清理的暂存日志（${view.staging.stepId} / ${view.staging.phase}）` : ''}。
        可单步执行或自动运行；先在任意步骤卡片上注入故障，再观察失败后的行为。
      </span>
    </div>
  )
}

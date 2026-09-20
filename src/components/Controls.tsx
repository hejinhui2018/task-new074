import type { EngineView } from '../engine/vault'

interface Props {
  view: EngineView
  running: boolean
  speedMs: number
  onSpeed: (ms: number) => void
  onStep: () => void
  onAuto: () => void
  onPause: () => void
  onRefresh: () => void
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  onSeed: (kind: 'v1' | 'v3' | 'future' | 'corrupt') => void
  onCorrupt: () => void
}

export function Controls(p: Props) {
  const { view, running } = p
  const canMigrate = view.status === 'ok' && view.mode === 'normal' && !view.dead && view.plan.length > 0

  return (
    <div className="panel">
      <div className="panel-hd">
        控制台
        <span className="hint">
          所有操作都真实写入浏览器 localStorage（statevault:* 三个键），关掉标签页再打开依然在。
        </span>
      </div>
      <div className="panel-bd" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="btn-row">
          <button className="btn primary" onClick={p.onStep} disabled={!canMigrate || running}>
            ▶ 单步执行 v{view.version}→v{(view.version ?? 0) + 1}
          </button>
          {!running ? (
            <button className="btn" onClick={p.onAuto} disabled={!canMigrate}>
              ⏩ 自动运行到 v5
            </button>
          ) : (
            <button className="btn" onClick={p.onPause}>
              ⏸ 暂停
            </button>
          )}
          <span className="speed">
            节奏
            <input
              type="range"
              min={300}
              max={3000}
              step={100}
              value={p.speedMs}
              onChange={(e) => p.onSpeed(Number(e.target.value))}
            />
            {(p.speedMs / 1000).toFixed(1)}s/步
          </span>
          <span className="divider-v" />
          <button className="btn" onClick={p.onRefresh}>
            🔄 刷新恢复
          </button>
          <button className="btn" onClick={p.onUndo} disabled={view.undoDepth === 0 || running || view.dead}>
            ↩ 撤销 ({view.undoDepth})
          </button>
          <button className="btn" onClick={p.onRedo} disabled={view.redoDepth === 0 || running || view.dead}>
            ↪ 重做 ({view.redoDepth})
          </button>
          <button className="btn danger" onClick={p.onReset}>
            ♻ 重置
          </button>
        </div>

        <div className="btn-row">
          <span className="muted">场景装载：</span>
          <button className="btn ghost tiny" onClick={() => p.onSeed('v1')}>
            v1 老用户（跨 4 版，含脏 theme）
          </button>
          <button className="btn ghost tiny" onClick={() => p.onSeed('v3')}>
            v3 中途回归用户（跨 2 版）
          </button>
          <button className="btn ghost tiny" onClick={() => p.onSeed('future')}>
            未来 v7 数据（降级只读）
          </button>
          <button className="btn ghost tiny" onClick={() => p.onSeed('corrupt')}>
            损坏快照（半截 JSON）
          </button>
          <button className="btn ghost tiny" onClick={p.onCorrupt} disabled={!view.doc || view.dead}>
            🧨 运行中把主快照写坏
          </button>
        </div>
      </div>
    </div>
  )
}

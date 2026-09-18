import type { DraftApi } from '../state/useDraft'

let fieldSeq = 0
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  const id = `numfield-${label}-${fieldSeq++}`
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.round(v))))
        }}
      />
    </div>
  )
}

export default function Controls({ draft }: { draft: DraftApi }) {
  const { state, changeSettings, resetToDefault } = draft
  const s = state.settings

  return (
    <div className="controls">
      <section className="card">
        <div className="panel-title">
          <span>规格与循环</span>
          <button className="btn" onClick={resetToDefault} title="放弃当前设计，恢复内置破斜纹样稿">
            恢复内置样稿
          </button>
        </div>
        <div className="field-grid">
          <NumberField label="综框数" value={s.harnessCount} min={2} max={16} onChange={(v) => changeSettings({ harnessCount: v })} />
          <NumberField label="踏板数" value={s.treadleCount} min={2} max={16} onChange={(v) => changeSettings({ treadleCount: v })} />
          <NumberField label="最大浮线" value={s.maxFloat} min={1} max={64} onChange={(v) => changeSettings({ maxFloat: v })} />
          <NumberField label="经纱根数" value={s.warpCount} min={4} max={128} onChange={(v) => changeSettings({ warpCount: v })} />
          <NumberField label="纬纱行数" value={s.weftCount} min={4} max={128} onChange={(v) => changeSettings({ weftCount: v })} />
          <div />
          <NumberField label="穿综循环长度" value={s.threadingRepeat} min={1} max={s.warpCount} onChange={(v) => changeSettings({ threadingRepeat: v })} />
          <NumberField label="踏纹循环长度" value={s.treadlingRepeat} min={1} max={s.weftCount} onChange={(v) => changeSettings({ treadlingRepeat: v })} />
        </div>
        <div className="field-grid" style={{ marginTop: 10, gridTemplateColumns: '1fr 1fr 1fr' }}>
          <div className="field">
            <label>经纱颜色</label>
            <input type="color" value={s.warpColor} onChange={(e) => changeSettings({ warpColor: e.target.value })} />
          </div>
          <div className="field">
            <label>纬纱颜色</label>
            <input type="color" value={s.weftColor} onChange={(e) => changeSettings({ weftColor: e.target.value })} />
          </div>
          <div className="field">
            <label>图例</label>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', paddingTop: 5 }}>
              <span className="swatch" style={{ background: s.warpColor }} />
              经浮
              <span className="swatch" style={{ background: s.weftColor, marginLeft: 10 }} />
              纬浮
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="panel-title">
          <span>逐纬试织预演</span>
          <span className="progress">
            已织 {draft.revealed}/{s.weftCount} 纬
          </span>
        </div>
        <div className="playback">
          {draft.playing ? (
            <button className="btn" onClick={draft.pause}>暂停</button>
          ) : (
            <button className="btn primary" onClick={draft.play}>
              {draft.revealed >= s.weftCount ? '重新播放' : '播放'}
            </button>
          )}
          <button className="btn" onClick={draft.stepBack} disabled={draft.revealed === 0}>上一纬</button>
          <button className="btn" onClick={draft.stepForward} disabled={draft.revealed >= s.weftCount}>下一纬</button>
          <button className="btn" onClick={draft.resetPlayback}>回到起点</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-soft)' }}>
            速度
            <input
              type="range"
              min={80}
              max={1200}
              step={20}
              value={1280 - draft.speedMs}
              onChange={(e) => draft.setSpeedMs(1280 - Number(e.target.value))}
            />
          </label>
        </div>
        <p className="locate-hint" style={{ color: 'var(--ink-soft)' }}>
          播放时按踏纹顺序逐行生成布面；播放中修改穿综、提综或踏纹，下一行起立即采用最新组织（从当前行继续无需重放）。
        </p>
      </section>
    </div>
  )
}

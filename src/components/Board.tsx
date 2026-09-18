import { useEffect, useRef } from 'react'
import type { WeaveMatrix, WeaveState } from '../lib/types'
import type { FloatRun } from '../lib/floats'
import { floatKeyOf } from '../lib/floats'
import type { Highlights } from './types'

interface BoardProps {
  state: WeaveState
  matrix: WeaveMatrix
  threadingExpanded: number[]
  treadlingExpanded: number[]
  floats: FloatRun[]
  selectedKey: string | null
  onSelectFloat: (key: string | null) => void
  highlights: Highlights
  revealed: number
  onPaintThread: (unitIndex: number, harness: number) => void
  onPaintTreadle: (unitIndex: number, treadle: number) => void
  onToggleTie: (harness: number, treadle: number) => void
}

/** 把浮线格点整理成便于查表的结构 */
function useFloatIndex(floats: FloatRun[]) {
  const cellMap = new Map<string, FloatRun>()
  const startSet = new Set<string>()
  for (const f of floats) {
    for (const p of f.cells) cellMap.set(`${p.r}-${p.c}`, f)
    startSet.add(`${f.row}-${f.col}`)
  }
  return {
    at: (r: number, c: number) => cellMap.get(`${r}-${c}`),
    isStart: (r: number, c: number) => startSet.has(`${r}-${c}`),
  }
}

const AXIS_STEP = 4

export default function Board(props: BoardProps) {
  const {
    state,
    matrix,
    threadingExpanded,
    treadlingExpanded,
    floats,
    selectedKey,
    onSelectFloat,
    highlights,
    revealed,
    onPaintThread,
    onPaintTreadle,
    onToggleTie,
  } = props
  const { settings } = state
  const H = settings.harnessCount
  const T = settings.treadleCount
  const W = settings.warpCount
  const R = settings.weftCount

  // 按住鼠标扫过即可连续涂画穿综 / 踏纹
  const painting = useRef(false)
  useEffect(() => {
    const up = () => {
      painting.current = false
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  const fi = useFloatIndex(floats)

  const cell = 'var(--cell)'
  const style3x3: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `18px calc(${cell} * ${T}) calc(${cell} * ${W})`,
    gridTemplateRows: `18px calc(${cell} * ${H}) calc(${cell} * ${R})`,
    gap: '4px 6px',
    width: 'max-content',
  }
  const gridStyle = (rows: number, cols: number): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, ${cell})`,
    gridTemplateRows: `repeat(${rows}, ${cell})`,
  })

  // 标签轴：每 AXIS_STEP 格显示序号
  const AxisTop = ({ n }: { n: number }) => (
    <div style={gridStyle(1, n)}>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="lab axis axis-h">
          {i % AXIS_STEP === 0 ? i + 1 : ''}
        </div>
      ))}
    </div>
  )
  const AxisLeft = ({ n, topIsN }: { n: number; topIsN?: boolean }) => (
    <div style={gridStyle(n, 1)}>
      {Array.from({ length: n }, (_, k) => {
        const i = topIsN ? n - 1 - k : k
        return (
          <div key={k} className="lab axis axis-v">
            {i % AXIS_STEP === 0 ? i + 1 : ''}
          </div>
        )
      })}
    </div>
  )

  return (
    <div className="board-scroll">
      <div style={style3x3}>
        {/* 角标留白 */}
        <div />

        {/* 踏板序号（连接矩阵与踏纹共用列） */}
        <div>
          <AxisTop n={T} />
        </div>

        {/* 经纱序号（穿综与组织图共用列） */}
        <div>
          <AxisTop n={W} />
        </div>

        {/* 综框序号（顶部为第 H 片综） */}
        <AxisLeft n={H} topIsN />

        {/* 连接矩阵 */}
        <div
          className={highlights.active ? 'dimmed' : ''}
          aria-label="综框与踏板连接矩阵"
        >
          <div className="grid" style={gridStyle(H, T)}>
            {Array.from({ length: H }, (_, k) => {
              const h = H - 1 - k
              return Array.from({ length: T }, (_, t) => {
                const on = state.tieUp[h][t]
                const causal = highlights.tieCells.has(`${h}-${t}`)
                const candidate = highlights.tieCandidates.has(`${h}-${t}`)
                return (
                  <button
                    key={`${h}-${t}`}
                    className={[
                      'cell tie-cell',
                      on ? 'on' : '',
                      causal ? 'causal' : '',
                      candidate ? 'candidate' : '',
                      highlights.active && highlights.treadles.has(t) ? 'locate-col' : '',
                      highlights.active && highlights.harnesses.has(h) ? 'locate-row' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={
                      candidate
                        ? `综框 ${h + 1} × 踏板 ${t + 1}：未连接——纬浮线成因，可在此补连接提起该综`
                        : `综框 ${h + 1} × 踏板 ${t + 1}：${on ? '连接，踩下时提起该综' : '不连接'}`
                    }
                    onClick={() => onToggleTie(h, t)}
                  />
                )
              })
            })}
          </div>
        </div>

        {/* 穿综图 */}
        <div className={highlights.active ? 'dimmed' : ''} aria-label="穿综图">
          <div className="grid" style={gridStyle(H, W)}>
            {Array.from({ length: H }, (_, k) => {
              const h = H - 1 - k
              return Array.from({ length: W }, (_, c) => {
                const unit = c % settings.threadingRepeat
                const active = threadingExpanded[c] === h
                const located = highlights.threadCols.has(c)
                return (
                  <button
                    key={`${h}-${c}`}
                    className={[
                      'cell thread-cell',
                      highlights.threadUnits.has(unit) ? 'equivalent' : '',
                      located ? 'locate-col' : '',
                      (c + 1) % settings.threadingRepeat === 0 ? 'boundary-right' : '',
                    ]                      .filter(Boolean)
                      .join(' ')}
                    title={`经纱 ${c + 1} → 综框 ${threadingExpanded[c] + 1}（穿综循环位 ${unit + 1}），点击改穿此综`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      painting.current = true
                      onPaintThread(unit, h)
                    }}
                    onMouseOver={() => {
                      if (painting.current) onPaintThread(unit, h)
                    }}
                  >
                    {active && <span className="peg" />}
                  </button>
                )
              })
            })}
          </div>
        </div>

        {/* 纬纱序号 */}
        <AxisLeft n={R} />

        {/* 踏纹图 */}
        <div className={highlights.active ? 'dimmed' : ''} aria-label="踏纹序列">
          <div className="grid" style={gridStyle(R, T)}>
            {Array.from({ length: R }, (_, r) =>
              Array.from({ length: T }, (_, t) => {
                const unit = r % settings.treadlingRepeat
                const active = treadlingExpanded[r] === t
                const located = highlights.treadRows.has(r)
                const next = r === revealed && revealed < R
                return (
                  <button
                    key={`${r}-${t}`}
                    className={[
                      'cell treadle-cell',
                      highlights.treadUnits.has(unit) ? 'equivalent' : '',
                      located ? 'locate-row' : '',
                      next ? 'next-pick' : '',
                      (r + 1) % settings.treadlingRepeat === 0 ? 'boundary-bottom' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title={`第 ${r + 1} 纬 → 踏板 ${treadlingExpanded[r] + 1}（踏纹循环位 ${
                      unit + 1
                    }），点击改踩此踏板${next ? '——下一纬' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      painting.current = true
                      onPaintTreadle(unit, t)
                    }}
                    onMouseOver={() => {
                      if (painting.current) onPaintTreadle(unit, t)
                    }}
                  >
                    {active && <span className="peg" />}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* 组织图：始终显示完整计算结果；已织行全饱和，未织行淡化，浮线始终可点 */}
        <div aria-label="组织图">
          <div className="grid" style={gridStyle(R, W)}>
            {matrix.map((row, r) =>
              row.map((v, c) => {
                const woven = r < revealed
                const isNextRow = r === revealed && revealed < R
                const f = fi.at(r, c)
                const isStart = fi.isStart(r, c)
                const key = f ? floatKeyOf(f) : null
                const selected = key !== null && key === selectedKey
                return (
                  <button
                    key={`${r}-${c}`}
                    className={[
                      'cell weave-cell',
                      woven ? 'woven' : 'pending',
                      isNextRow ? 'next-row' : '',
                      f ? 'float' : '',
                      selected ? 'selected' : '',
                      highlights.active && highlights.threadCols.has(c) ? 'locate-col' : '',
                      highlights.active && highlights.treadRows.has(r) ? 'locate-row' : '',
                      (c + 1) % settings.threadingRepeat === 0 ? 'boundary-right' : '',
                      (r + 1) % settings.treadlingRepeat === 0 ? 'boundary-bottom' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ background: v === 1 ? settings.warpColor : settings.weftColor }}
                    title={
                      f
                        ? `${f.kind === 'warp' ? '经' : '纬'}浮线，长度 ${f.length} 格（起于第 ${r + 1} 纬、第 ${
                            c + 1
                          } 经）${f.wrap ? '，跨循环接缝' : ''}。点击定位到穿综 / 踏纹`
                        : `第 ${r + 1} 纬 × 第 ${c + 1} 经：${v === 1 ? '经浮点（经在上）' : '纬浮点（纬在上）'}`
                    }
                    onClick={() => f && onSelectFloat(selected ? null : floatKeyOf(f))}
                  >
                    {f && isStart && (
                      <span className="float-badge">
                        {f.kind === 'warp' ? '↕' : '↔'}
                        {f.length}
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

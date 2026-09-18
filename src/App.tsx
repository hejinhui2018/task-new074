import Board from './components/Board'
import Controls from './components/Controls'
import FloatPanel from './components/FloatPanel'
import { useDraft, useHighlights } from './state/useDraft'

export default function App() {
  const draft = useDraft()
  const { selectedFloat, state, threadingExpanded, treadlingExpanded } = draft
  const highlights = useHighlights(selectedFloat, {
    threadingExpanded,
    treadlingExpanded,
    threadingRepeat: state.settings.threadingRepeat,
    treadlingRepeat: state.settings.treadlingRepeat,
    tieUp: state.tieUp,
  })

  return (
    <div className="app">
      <header className="app-header">
        <h1>织物组织设计台</h1>
        <span className="sub">
          穿综 × 提综 × 踏纹 → 组织图实时联动 · 8 综 8 踏板 32×24 破斜纹内置样稿 · 数据自动保存在本机浏览器
        </span>
      </header>

      <Controls draft={draft} />

      <section className="card">
        <div className="panel-title">
          <span>四联组织图（左上连接矩阵 / 右上穿综 / 左下踏纹 / 右下组织图，行列严格对齐）</span>
        </div>
        <Board
          state={state}
          matrix={draft.matrix}
          threadingExpanded={threadingExpanded}
          treadlingExpanded={treadlingExpanded}
          floats={draft.floats}
          selectedKey={draft.selectedKey}
          onSelectFloat={draft.selectFloat}
          highlights={highlights}
          revealed={draft.revealed}
          onPaintThread={draft.editThreading}
          onPaintTreadle={draft.editTreadling}
          onToggleTie={draft.editTie}
        />
        <div className="legend">
          <span>
            <span className="swatch" style={{ background: '#33302a' }} />
            综钉 / 连接（提起）
          </span>
          <span>粗线为循环接缝</span>
          <span>红色描边＋徽标 ↕/↔ 与数字 = 超长浮线的方向和长度</span>
          <span>琥珀色框 = 下一纬将踩的踏板</span>
        </div>
      </section>

      <div className="two-col">
        <FloatPanel draft={draft} />
        <section className="card">
          <div className="panel-title">
            <span>读图与操作说明</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--ink-soft)' }}>
            <li>穿综 / 踏纹：点击或按住鼠标扫过格点即可改穿综框 / 改踩踏板；组织图随之整幅重算。</li>
            <li>连接矩阵：点击格子切换“踩该踏板时是否提起该综框”。</li>
            <li>穿综、踏纹按各自循环长度铺满整幅，修改一个循环位会作用到所有重复列 / 行。</li>
            <li>浮线检测考虑循环铺贴，跨首尾接缝的连续浮线也会标出。</li>
            <li>点击红框浮线或右侧问题：组织图中蓝框标出成因经列 / 纬行；连接矩阵红格＝导致经浮线的连接，琥珀格＝纬浮线应提未提的空位，点击可直接修改。</li>
            <li>试织预演逐行铺出真实布面颜色；编辑后后续行立即按最新组织生成。</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

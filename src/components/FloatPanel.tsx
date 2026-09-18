import type { DraftApi } from '../state/useDraft'
import { floatKeyOf } from '../lib/floats'

export default function FloatPanel({ draft }: { draft: DraftApi }) {
  const { floats, selectedKey, selectFloat, state } = draft
  const maxFloat = state.settings.maxFloat

  return (
    <section className="card">
      <div className="panel-title">
        <span>超长浮线（上限 {maxFloat} 格）</span>
        {floats.length === 0 ? (
          <span className="status-ok">无超长浮线</span>
        ) : (
          <span className="status-bad">{floats.length} 处</span>
        )}
      </div>

      {floats.length > 0 && (
        <div className="float-list" aria-label="超长浮线问题列表">
          {floats.map((f) => {
            const key = floatKeyOf(f)
            const selected = key === selectedKey
            return (
              <button
                key={key}
                className={`float-item ${selected ? 'selected' : ''}`}
                onClick={() => selectFloat(selected ? null : key)}
                title="在组织图中高亮，并定位到相关穿综 / 踏纹"
              >
                <span className={`tag ${f.kind}`}>{f.kind === 'warp' ? '经浮线 ↕' : '纬浮线 ↔'}</span>
                <span>
                  第 {f.row + 1} 纬 · 第 {f.col + 1} 经起
                  {f.wrap && '（跨循环接缝）'}
                </span>
                <span className="meta">
                  {f.kind === 'warp'
                    ? `经纱连续压过 ${f.length} 根纬纱`
                    : `纬纱连续压过 ${f.length} 根经纱`}
                </span>
                <span className="len">{f.length}</span>
              </button>
            )
          })}
        </div>
      )}

      <p className="locate-hint">
        {selectedKey
          ? '已定位：蓝框标出相关穿综列 / 踏纹行；连接矩阵红格＝导致经浮线的连接，琥珀格＝纬浮线“应提未提”的空位（点击即可补上连接）。再次点击取消。'
          : '点击问题或组织图中的红框浮线，可定位到相关穿综或踏纹。'}
      </p>
    </section>
  )
}

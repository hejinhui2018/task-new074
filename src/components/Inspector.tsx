import { useState } from 'react'
import type { EngineView } from '../engine/vault'
import { STORAGE_KEYS } from '../engine/storage'

interface Props {
  view: EngineView
  onClearQuarantine: () => void
}

type Tab = 'state' | 'storage' | 'quarantine' | 'logs'

function Json({ value }: { value: unknown }) {
  return <pre className="json">{JSON.stringify(value, null, 2)}</pre>
}

export function Inspector({ view, onClearQuarantine }: Props) {
  const [tab, setTab] = useState<Tab>('state')
  const qCount = view.quarantine.length

  const tabs: { key: Tab; label: string; hot?: boolean; count?: number }[] = [
    { key: 'state', label: '当前状态' },
    { key: 'storage', label: '暂存与回滚快照' },
    { key: 'quarantine', label: '隔离区', hot: qCount > 0, count: qCount },
    { key: 'logs', label: '运行日志', count: view.logs.length },
  ]

  return (
    <div className="panel">
      <div className="tabs">
        {tabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.count !== undefined && <span className={`count-pill ${t.hot ? 'hot' : ''}`}>{t.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: '14px 16px' }}>
        {tab === 'state' && <StateTab view={view} />}
        {tab === 'storage' && <StorageTab view={view} />}
        {tab === 'quarantine' && <QuarantineTab view={view} onClear={onClearQuarantine} />}
        {tab === 'logs' && <LogsTab view={view} />}
      </div>
    </div>
  )
}

function StateTab({ view }: { view: EngineView }) {
  if (view.status === 'empty') return <div className="empty"><span className="big">🗄️</span>还没有数据</div>
  if (view.status === 'quarantined') {
    return (
      <div className="empty">
        <span className="big">🛑</span>
        主快照不可读，已隔离。请到「隔离区」查看原始坏数据，或用回滚快照恢复。
      </div>
    )
  }
  if (view.mode === 'future-readonly') {
    return (
      <>
        <p className="muted" style={{ marginTop: 0 }}>
          未来版本数据以原样（不解析、不迁移、不回写）展示：
        </p>
        <Json value={view.rawFuture} />
      </>
    )
  }
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        当前主快照信封内的业务状态（每次迁移成功后整体替换）：
      </p>
      <Json value={view.state} />
    </>
  )
}

function StorageTab({ view }: { view: EngineView }) {
  return (
    <div className="two-col">
      <div>
        <div className="mini-label">localStorage 键位</div>
        <pre className="json">{JSON.stringify(STORAGE_KEYS, null, 2)}</pre>
        <div className="mini-label" style={{ marginTop: 12 }}>预写暂存日志（WAL）</div>
        {view.staging ? (
          <>
            <p className="muted" style={{ margin: '4px 0 6px' }}>
              存在未完成的 {view.staging.stepId}，阶段 <span className="mono">{view.staging.phase}</span>。
              刷新时据此判定是否需要重放——注意：提交完成时只会删日志，绝不会重跑迁移。
            </p>
            <Json value={view.staging} />
          </>
        ) : (
          <p className="muted">无暂存日志（空闲 / 迁移已完整提交）。</p>
        )}
      </div>
      <div>
        <div className="mini-label">回滚快照（上一个已验证完好版本）</div>
        {view.rollback ? (
          <>
            <p className="muted" style={{ margin: '4px 0 6px' }}>
              来自 {view.rollback.stepId} 提交前，保存于 {view.rollback.savedAt}。
              主快照损坏时可一键恢复；隔离区中的坏数据不会被它覆盖。
            </p>
            <Json value={view.rollback.doc.state} />
          </>
        ) : (
          <p className="muted">尚无回滚快照（第一次成功提交后生成）。</p>
        )}
      </div>
    </div>
  )
}

function QuarantineTab({ view, onClear }: { view: EngineView; onClear: () => void }) {
  if (view.quarantine.length === 0) {
    return (
      <div className="empty">
        <span className="big">🧯</span>
        隔离区为空。<br />
        坏数据（半截写入、校验失败的迁移产物）会原样存到这里，主快照与回滚快照都不会覆盖它们。
      </div>
    )
  }
  return (
    <>
      <div className="btn-row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
        <span className="muted">共 {view.quarantine.length} 份隔离数据，均保留原始内容</span>
        <button className="btn tiny danger" onClick={onClear}>清空隔离区</button>
      </div>
      {[...view.quarantine].reverse().map((q) => (
        <div key={q.id} className="q-item">
          <div className="q-hd">
            <span className="mono">{q.reason}</span>
            <span>来源：{q.source === 'main-snapshot' ? '主快照' : '迁移产物'}</span>
            {q.stepId && <span className="mono">{q.stepId}</span>}
            <span className="time">{q.capturedAt}</span>
          </div>
          <div className="q-bd">
            <p>{q.detail}</p>
            {q.issues && q.issues.length > 0 && (
              <ul className="issues">
                {q.issues.map((is, i) => (
                  <li key={i}>
                    <code>{is.path}</code> — {is.message}
                  </li>
                ))}
              </ul>
            )}
            <Json value={q.raw} />
          </div>
        </div>
      ))}
    </>
  )
}

function LogsTab({ view }: { view: EngineView }) {
  if (view.logs.length === 0) return <div className="empty">暂无日志</div>
  return (
    <div className="log-list">
      {[...view.logs].reverse().map((l) => (
        <div key={l.id} className={`log-row ${l.level}`}>
          <span className="lt">{l.t.slice(11, 23)}</span>
          <span className="ll">
            {l.level === 'success' ? '成功' : l.level === 'error' ? '错误' : l.level === 'warn' ? '警告' : '信息'}
          </span>
          <span className="lm">{l.message}</span>
        </div>
      ))}
    </div>
  )
}

import { useVault } from './hooks/useVault'
import { Banners } from './components/Banners'
import { Controls } from './components/Controls'
import { Pipeline } from './components/Pipeline'
import { Inspector } from './components/Inspector'

export default function App() {
  const v = useVault()
  const { view } = v

  const modeBadge =
    view.status === 'empty'
      ? <span className="badge"><span className="dot" />无快照</span>
      : view.status === 'quarantined'
        ? <span className="badge err"><span className="dot" />主快照已隔离</span>
        : view.mode === 'future-readonly'
          ? <span className="badge warn"><span className="dot" />降级只读</span>
          : <span className="badge ok"><span className="dot" />可读写</span>

  return (
    <div className="app">
      <div className="topbar">
        <h1><span className="logo">StateVault</span> · 本地状态迁移验收台</h1>
        <span className="subtitle">React + TypeScript + Vite — 版本化状态 / 原子迁移 / 校验 / 回滚快照 / 损坏隔离</span>
      </div>

      <div className="statusline">
        {modeBadge}
        <span className="badge info">
          主快照版本：<strong style={{ marginLeft: 4 }}>{view.version === null ? '—' : `v${view.version}`}</strong>
        </span>
        <span className="badge">
          暂存日志：<strong style={{ marginLeft: 4 }}>{view.staging ? `${view.staging.stepId} · ${view.staging.phase}` : '无'}</strong>
        </span>
        <span className={view.rollback ? 'badge purple' : 'badge'}>
          回滚快照：<strong style={{ marginLeft: 4 }}>{view.rollback ? `v${view.rollback.doc.state.version}` : '无'}</strong>
        </span>
        <span className={view.quarantine.length > 0 ? 'badge err' : 'badge'}>
          隔离区：<strong style={{ marginLeft: 4 }}>{view.quarantine.length}</strong>
        </span>
        {view.dead && <span className="badge warn spin"><span className="dot" />进程已终止·待刷新</span>}
        {v.running && <span className="badge info spin"><span className="dot" />自动运行中</span>}
      </div>

      <Banners view={view} running={v.running} onRestoreRollback={v.restoreRollback} />

      <Controls
        view={view}
        running={v.running}
        speedMs={v.speedMs}
        onSpeed={v.setSpeedMs}
        onStep={v.step}
        onAuto={v.startAuto}
        onPause={v.pause}
        onRefresh={v.refresh}
        onUndo={v.undo}
        onRedo={v.redo}
        onReset={v.reset}
        onSeed={v.seed}
        onCorrupt={v.corruptNow}
      />

      <Pipeline view={view} traces={v.traces} onSetFault={v.setFault} />

      <Inspector view={view} onClearQuarantine={v.clearQuarantine} />

      <div className="section-title">验收要点</div>
      <div className="panel">
        <div className="panel-bd muted" style={{ lineHeight: 1.9 }}>
          <strong style={{ color: 'var(--text-dim)' }}>建议按顺序验收：</strong>
          <ol style={{ margin: '6px 0', paddingLeft: 20 }}>
            <li><b>跨多版</b>：装载「v1 老用户」→ 自动运行到 v5，观察脏 theme 归一化、数组转字典等每步变更与校验。</li>
            <li><b>重复运行</b>：到 v5 后再点单步/自动，全部被跳过；对某一步撤销后重跑，结果与首次一致（幂等）。</li>
            <li><b>中途失败</b>：在 2→3 上挂「产物校验失败」，自动运行：半成品进隔离区，主快照停在 v2，排除故障后可继续。</li>
            <li><b>中断/刷新</b>：挂「转换前断电」或「提交后断电」→ 点「刷新恢复」，日志会说明为何不重放或为何安全丢弃半成品。</li>
            <li><b>写坏主快照</b>：迁移成功后点「运行中把主快照写坏」→ 刷新，坏数据进隔离区，可用回滚快照恢复且隔离数据保留。</li>
            <li><b>降级读取</b>：装载「未来 v7 数据」，数据只读展示、禁止迁移，任何操作都不会覆盖它。</li>
          </ol>
          另有程序化断言：<code className="mono">npm test</code>（Node 内存存储跑全部场景）。
        </div>
      </div>
    </div>
  )
}

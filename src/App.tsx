import { useMemo } from 'react';
import { detectVersion } from './engine/migrations';
import { useVault } from './state/useVault';
import { ControlBar } from './components/ControlBar';
import { MigrationSteps } from './components/MigrationSteps';
import { RecoveryBanner } from './components/RecoveryBanner';
import { ScenarioPanel } from './components/ScenarioPanel';
import { EventLog, HistoryStacks, LiveInspector, QuarantineList, SnapshotList } from './components/Inspectors';

export default function App() {
  const { state, actions } = useVault();

  const liveVersion = useMemo(() => detectVersion(state.live) ?? 0, [state.live]);
  const running = !!state.pending;
  const storageOn = typeof localStorage !== 'undefined';

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark">SV</div>
          <div>
            <h1>StateVault · 本地状态迁移验收台</h1>
            <div className="sub">版本化状态 · 原子迁移 · 校验闸门 · 回滚快照 · 损坏隔离 · 刷新恢复</div>
          </div>
        </div>
        <div className="topbar-spacer" />
        <span className="storage-pill">
          持久化：<b>{storageOn ? 'localStorage 已连接' : '不可用（仅内存）'}</b>
        </span>
      </div>

      <RecoveryBanner
        recovery={state.recovery}
        readOnly={state.readOnly}
        onContinue={actions.resume}
        onAbort={actions.abortPending}
        onDismiss={actions.dismissRecovery}
        onReset={() => actions.resetTo(0)}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ControlBar
          liveVersion={liveVersion}
          pending={state.pending}
          readOnly={state.readOnly}
          canUndo={state.history.length > 0 && !running && !state.readOnly}
          canRedo={state.future.length > 0 && !running && !state.readOnly}
          actions={actions}
        />

        <ScenarioPanel actions={actions} running={running} />

        <div className="grid">
          <div className="col">
            <MigrationSteps liveVersion={liveVersion} pending={state.pending} records={state.lastRun?.records ?? {}} live={state.live} />
            <EventLog events={state.events} />
          </div>
          <div className="col">
            <LiveInspector live={state.live} readOnly={state.readOnly} />
            <SnapshotList
              snapshots={state.snapshots}
              disabled={running || state.readOnly}
              onRestore={actions.restoreSnapshot}
            />
            <QuarantineList
              items={state.quarantine}
              onRemove={actions.removeQuarantine}
              onClear={actions.clearQuarantine}
            />
            <HistoryStacks history={state.history} future={state.future} />
          </div>
        </div>
      </div>

      <div className="foot-note">
        每个迁移步骤只在 <code>快照 → 变更 → 校验</code> 全部成功后原子提交；失败的半成品进入隔离区，live 与前置快照不变。
        <br />
        版本号是唯一真相：同一迁移重跑会被跳过；进行中的计划随信封落盘，刷新后从中断处继续；未来版本存档只读保留。
      </div>
    </div>
  );
}

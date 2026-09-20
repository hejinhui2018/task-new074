import { HistoryEntry, LogEvent, QuarantineItem, RollbackSnapshot } from '../engine/types';
import { detectVersion } from '../engine/migrations';
import { fmtTime, JsonView } from './ui';

/* ------------------------------- live 状态 ------------------------------- */

export function LiveInspector({ live, readOnly }: { live: unknown; readOnly: boolean }) {
  const v = detectVersion(live) ?? '?';
  return (
    <div className="card">
      <div className="card-head">
        <h2>live 状态（localStorage 中的当前真相）</h2>
        <span className="spacer" />
        <span className={`badge badge-${readOnly ? 'readonly' : 'success'}`}>v{v} {readOnly ? '· 只读' : ''}</span>
      </div>
      <div className="card-body">
        <JsonView value={live} />
      </div>
    </div>
  );
}

/* ------------------------------- 回滚快照 ------------------------------- */

export function SnapshotList({
  snapshots,
  disabled,
  onRestore,
}: {
  snapshots: RollbackSnapshot[];
  disabled: boolean;
  onRestore: (index: number) => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>回滚快照</h2>
        <span className="hint">每步执行前的深拷贝，失败即回到这里；最近在前</span>
        <span className="spacer" />
        <span className="badge badge-neutral">{snapshots.length}</span>
      </div>
      <div className="card-body">
        {snapshots.length === 0 ? (
          <div className="empty">暂无快照（开始迁移后逐步产生）</div>
        ) : (
          <div className="list">
            {[...snapshots].reverse().map((s, revI) => {
              const i = snapshots.length - 1 - revI;
              return (
                <div className="list-item" key={`${s.at}-${i}`}>
                  <div className="li-head">
                    <span className="li-title">
                      v{detectVersion(s.state) ?? '?'} 前置快照
                    </span>
                    <span className="li-time">{fmtTime(s.at)}</span>
                  </div>
                  <div className="li-text">{s.reason}</div>
                  <div style={{ marginTop: 7 }}>
                    <button className="btn btn-sm" disabled={disabled} onClick={() => onRestore(i)}>
                      从此快照恢复
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------- 隔离区 -------------------------------- */

export function QuarantineList({
  items,
  onRemove,
  onClear,
}: {
  items: QuarantineItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>🧺 隔离区</h2>
        <span className="hint">半成品 / 损坏原文只存这里，绝不覆盖 live 与快照</span>
        <span className="spacer" />
        {items.length > 0 && (
          <button className="btn btn-sm" onClick={onClear}>
            清空
          </button>
        )}
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <div className="empty">隔离区为空 —— 迁移失败或存储损坏的数据会出现在这里</div>
        ) : (
          <div className="list">
            {[...items].reverse().map((q) => (
              <div className="list-item" key={q.id}>
                <div className="li-head">
                  <span className="badge badge-danger">
                    {q.source === 'storage' ? '存储损坏' : `迁移 ${q.migrationId ?? '?'} · ${q.stage ?? ''}`}
                  </span>
                  <span className="li-time">{fmtTime(q.t)}</span>
                </div>
                <div className="li-text" style={{ color: '#f0a39d' }}>
                  {q.reason}
                </div>
                {q.payload !== undefined && (
                  <details className="mini">
                    <summary>查看被隔离的半成品</summary>
                    <JsonView value={q.payload} maxHeight={200} />
                  </details>
                )}
                {q.raw !== undefined && (
                  <details className="mini" open>
                    <summary>损坏原文（完整保留，未被覆盖）</summary>
                    <div className="raw-box">{q.raw || '(空内容)'}</div>
                  </details>
                )}
                <div style={{ marginTop: 7 }}>
                  <button className="btn btn-sm" onClick={() => onRemove(q.id)}>
                    移除该条
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 撤销 / 重做栈 ------------------------------ */

export function HistoryStacks({ history, future }: { history: HistoryEntry[]; future: HistoryEntry[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>撤销 / 重做栈</h2>
        <span className="spacer" />
        <span className="badge badge-neutral">↶ {history.length} · ↷ {future.length}</span>
      </div>
      <div className="card-body">
        <div className="list" style={{ maxHeight: 220 }}>
          {history.length === 0 && future.length === 0 && <div className="empty">尚无变更记录</div>}
          {[...future].reverse().map((h) => (
            <div className="list-item" key={h.id} style={{ opacity: 0.55, borderStyle: 'dashed' }}>
              <div className="li-head">
                <span className="badge badge-skipped">重做栈</span>
                <span className="li-title" style={{ fontSize: 12 }}>
                  {h.label}
                </span>
                <span className="li-time">
                  v{h.fromVersion}→v{h.toVersion}
                </span>
              </div>
            </div>
          ))}
          {[...history].reverse().map((h) => (
            <div className="list-item" key={h.id}>
              <div className="li-head">
                <span className={`badge badge-${h.kind === 'rollback' ? 'warn' : h.kind === 'reset' ? 'neutral' : 'success'}`}>
                  {kindLabel(h.kind)}
                </span>
                <span className="li-title" style={{ fontSize: 12 }}>
                  {h.label}
                </span>
                <span className="li-time">
                  {fmtTime(h.t)} · v{h.fromVersion}→v{h.toVersion}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function kindLabel(kind: HistoryEntry['kind']): string {
  switch (kind) {
    case 'step':
      return '迁移';
    case 'reset':
      return '重置';
    case 'load':
      return '载入';
    case 'rollback':
      return '快照恢复';
  }
}

/* --------------------------------- 日志 --------------------------------- */

export function EventLog({ events }: { events: LogEvent[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>事件日志</h2>
        <span className="hint">每次尝试、跳过、校验、回滚、恢复都有记录</span>
        <span className="spacer" />
        <span className="badge badge-neutral">{events.length}</span>
      </div>
      <div className="card-body">
        <div className="log">
          {[...events].reverse().map((e) => (
            <div className={`log-row ${e.level}`} key={e.id}>
              <span className="log-time">{fmtTime(e.t)}</span>
              <span className={`log-dot log-dot-${e.level}`} />
              <span className="log-text">{e.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

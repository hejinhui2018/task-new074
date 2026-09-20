/**
 * useVault —— 把 VaultEngine 接到 React。
 * - useSyncExternalStore 订阅
 * - pending.auto 时用 setTimeout 链驱动自动运行（可暂停 / 中断 / 刷新恢复）
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { VaultEngine } from '../engine/engine';
import { FaultKind } from '../engine/types';

export const AUTO_TICK_DELAY_MS = 900;

export interface VaultActions {
  /** 单步：没有计划时建立手动计划，然后推进一次 */
  stepOnce: (fault?: { stepId: string; kind: FaultKind } | null) => void;
  startAuto: (fault?: { stepId: string; kind: FaultKind } | null) => void;
  pause: () => void;
  resume: () => void;
  armFault: (stepId: string | null, kind?: FaultKind) => void;
  abortPending: () => void;
  undo: () => void;
  redo: () => void;
  resetTo: (version: number) => void;
  restoreSnapshot: (index: number) => void;
  restoreLastSnapshot: () => void;
  removeQuarantine: (id: string) => void;
  clearQuarantine: () => void;
  dismissRecovery: () => void;
  /** 模拟浏览器刷新（迁移中途也可以点） */
  reload: () => void;
  /** 同步跑完计划中的全部剩余步骤（无动画，用于验收场景与重复执行测试） */
  runAllSync: (fault?: { stepId: string; kind: FaultKind } | null) => void;
  /** 走两步后刷新（模拟自动迁移中途崩溃 / 关页） */
  interruptAndReload: () => void;
  /** 写入无法解析的存储内容后刷新 */
  corruptStorageAndReload: () => void;
  /** 写入 v6 未来版本信封后刷新（降级读取） */
  futureVersionAndReload: () => void;
}

export function useVault() {
  const engineRef = useRef<VaultEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new VaultEngine();
  }
  const engine = engineRef.current;

  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  // 自动运行驱动：auto=true 且还有未完成步骤时延时推进
  const pending = state.pending;
  useEffect(() => {
    if (!pending?.auto) return;
    const id = window.setTimeout(() => engine.tick(), AUTO_TICK_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [pending, engine]);

  const actions = useMemo<VaultActions>(
    () => ({
      stepOnce: (fault = null) => {
        if (!engine.getSnapshot().pending) engine.beginRun({ auto: false, fault });
        engine.tick();
      },
      startAuto: (fault = null) => {
        engine.beginRun({ auto: true, fault });
      },
      pause: () => engine.pause(),
      resume: () => engine.resume(),
      armFault: (stepId, kind = 'corrupt') => engine.armFault(stepId, kind),
      abortPending: () => engine.abortPending(),
      undo: () => engine.undo(),
      redo: () => engine.redo(),
      resetTo: (version) => engine.resetTo(version),
      restoreSnapshot: (index) => engine.restoreSnapshot(index),
      restoreLastSnapshot: () => engine.restoreLastSnapshot(),
      removeQuarantine: (id) => engine.removeQuarantine(id),
      clearQuarantine: () => engine.clearQuarantine(),
      dismissRecovery: () => engine.dismissRecovery(),
      reload: () => window.location.reload(),
      runAllSync: (fault = null) => {
        engine.beginRun({ auto: false, fault });
        let guard = 0;
        while (engine.getSnapshot().pending && guard++ < 20) engine.tick();
      },
      interruptAndReload: () => {
        engine.resetTo(0);
        engine.beginRun({ auto: false });
        engine.tick();
        engine.tick(); // live=v2 已落盘、pending 指向 2->3，此刻“崩溃”
        window.location.reload();
      },
      corruptStorageAndReload: () => {
        engine.writeGarbage();
        window.location.reload();
      },
      futureVersionAndReload: () => {
        engine.writeFutureEnvelope();
        window.location.reload();
      },
    }),
    [engine],
  );

  const currentVersion = useCallback(() => {
    const s = engine.getSnapshot().live as { version?: unknown };
    return typeof s.version === 'number' ? s.version : 0;
  }, [engine]);

  return { state, actions, engine, currentVersion };
}

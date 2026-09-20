import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { MigrationEngine, type EngineView, type StepResult } from '../engine/vault'
import { LocalStorageKV } from '../engine/storage'
import { allMigrations, stepId } from '../engine/migrations'
import type { FaultKind } from '../engine/faults'

// 每步迁移的"最近一次执行结果"，由 UI 侧记录（引擎只返回结果）
export interface StepTrace {
  status: 'idle' | 'applied' | 'failed' | 'crashed'
  detail?: string
  t?: string
}

export type Traces = Record<string, StepTrace>

function makeEngine(): MigrationEngine {
  const engine = new MigrationEngine(new LocalStorageKV())
  engine.boot()
  return engine
}

export interface UseVault {
  view: EngineView
  traces: Traces
  running: boolean
  speedMs: number
  setSpeedMs: (ms: number) => void
  setFault: (id: string, kind: FaultKind | null, repeat: number) => void
  step: () => StepResult
  startAuto: () => void
  pause: () => void
  refresh: () => void
  undo: () => void
  redo: () => void
  reset: () => void
  seed: (kind: 'v1' | 'v3' | 'future' | 'corrupt') => void
  corruptNow: () => void
  restoreRollback: () => void
  clearQuarantine: () => void
  engine: MigrationEngine
}

export function useVault(): UseVault {
  // 引擎只创建一次（严格模式下 effect 双调用也不重复建：用 lazy ref）
  const engineRef = useRef<MigrationEngine | null>(null)
  if (engineRef.current === null) engineRef.current = makeEngine()
  const engine = engineRef.current

  const [, force] = useReducer((x: number) => x + 1, 0)
  const [running, setRunning] = useState(false)
  const [speedMs, setSpeedMs] = useState(1200)
  const [traces, setTraces] = useState<Traces>(() =>
    Object.fromEntries(allMigrations.map((m) => [stepId(m.from, m.to), { status: 'idle' as const }])),
  )
  const timerRef = useRef<number | null>(null)

  const view = engine.getView()

  const recordTrace = useCallback((result: StepResult) => {
    if (result.kind === 'skipped') return
    const id = stepId(result.step.from, result.step.to)
    const t = new Date().toISOString()
    setTraces((prev) => ({
      ...prev,
      [id]:
        result.kind === 'applied'
          ? { status: 'applied', t }
          : result.kind === 'crash'
            ? { status: 'crashed', detail: `断电：${result.fault}`, t }
            : { status: 'failed', detail: result.reason, t },
    }))
  }, [])

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const step = useCallback((): StepResult => {
    const result = engine.applyStep()
    recordTrace(result)
    force()
    return result
  }, [engine, recordTrace])

  const startAuto = useCallback(() => {
    setRunning(true)
  }, [])

  const pause = useCallback(() => {
    setRunning(false)
    clearTimer()
  }, [])

  // 自动运行调度：每 speedMs 推进一步；到底 / 失败 / 崩溃即停
  useEffect(() => {
    if (!running) return
    const v = engine.getView()
    if (v.plan.length === 0 || v.dead || v.status !== 'ok' || v.mode !== 'normal') {
      setRunning(false)
      return
    }
    timerRef.current = window.setTimeout(() => {
      const result = engine.applyStep()
      recordTrace(result)
      force()
      if (result.kind !== 'applied') setRunning(false)
    }, speedMs)
    return clearTimer
  }, [running, speedMs, engine, view.version, view.staging?.runNonce, recordTrace, view.dead, view.status, view.mode])

  const refresh = useCallback(() => {
    engine.recover()
    force()
  }, [engine])

  const undo = useCallback(() => {
    engine.undo()
    // 回退后所有已撤销步骤的 trace 回到 idle（便于演示"再跑一遍"）
    const v = engine.getView().version
    setTraces((prev) => {
      const next = { ...prev }
      for (const m of allMigrations) {
        if (m.from >= (v ?? 0)) next[stepId(m.from, m.to)] = { status: 'idle' }
      }
      return next
    })
    force()
  }, [engine])

  const redo = useCallback(() => {
    engine.redo()
    force()
  }, [engine])

  const reset = useCallback(() => {
    setRunning(false)
    clearTimer()
    engine.reset()
    setTraces(Object.fromEntries(allMigrations.map((m) => [stepId(m.from, m.to), { status: 'idle' as const }])))
    force()
  }, [engine])

  const seed = useCallback(
    (kind: 'v1' | 'v3' | 'future' | 'corrupt') => {
      setRunning(false)
      clearTimer()
      engine.loadSeed(kind)
      setTraces(Object.fromEntries(allMigrations.map((m) => [stepId(m.from, m.to), { status: 'idle' as const }])))
      force()
    },
    [engine],
  )

  const corruptNow = useCallback(() => {
    engine.corruptMainSnapshot()
    force()
  }, [engine])

  const restoreRollback = useCallback(() => {
    engine.restoreRollback()
    force()
  }, [engine])

  const clearQuarantine = useCallback(() => {
    engine.clearQuarantine()
    force()
  }, [engine])

  const setFault = useCallback(
    (id: string, kind: FaultKind | null, repeat: number) => {
      engine.faults.set(id, kind, repeat)
      force()
    },
    [engine],
  )

  return useMemo(
    () => ({
      view,
      traces,
      running,
      speedMs,
      setSpeedMs,
      setFault,
      step,
      startAuto,
      pause,
      refresh,
      undo,
      redo,
      reset,
      seed,
      corruptNow,
      restoreRollback,
      clearQuarantine,
      engine,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, traces, running, speedMs],
  )
}

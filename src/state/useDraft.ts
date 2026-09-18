import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DraftSettings, WeaveState } from '../lib/types'
import { createDefaultState } from '../lib/defaultDraft'
import { loadState, saveState } from '../lib/storage'
import {
  setThreadingCell,
  setTreadlingCell,
  toggleTieCell,
  updateSettings,
} from '../lib/edits'
import { computeWeave, expandedThreading, expandedTreadling } from '../lib/weave'
import { detectFloats, floatKeyOf, locateFloat, type FloatRun } from '../lib/floats'

export type { FloatRun }

export interface DraftApi {
  state: WeaveState
  matrix: ReturnType<typeof computeWeave>
  threadingExpanded: number[]
  treadlingExpanded: number[]
  floats: FloatRun[]
  selectedKey: string | null
  selectFloat: (key: string | null) => void
  selectedFloat: FloatRun | null
  editThreading: (unitIndex: number, harness: number) => void
  editTreadling: (unitIndex: number, treadle: number) => void
  editTie: (harness: number, treadle: number) => void
  changeSettings: (patch: Partial<DraftSettings>) => void
  resetToDefault: () => void
  // 播放
  revealed: number
  playing: boolean
  speedMs: number
  setSpeedMs: (ms: number) => void
  play: () => void
  pause: () => void
  stepForward: () => void
  stepBack: () => void
  resetPlayback: () => void
}

export function useDraft(): DraftApi {
  const [state, setState] = useState<WeaveState>(() => loadState())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speedMs, setSpeedMs] = useState(450)
  const timer = useRef<number | null>(null)

  // 持久化：任意修改后写入浏览器本地
  useEffect(() => {
    saveState(state)
  }, [state])

  const matrix = useMemo(() => computeWeave(state), [state])
  const threadingExpanded = useMemo(() => expandedThreading(state), [state])
  const treadlingExpanded = useMemo(() => expandedTreadling(state), [state])
  const floats = useMemo(
    () => detectFloats(matrix, state.settings.maxFloat),
    [matrix, state.settings.maxFloat]
  )

  // 组织变化（含编辑）后，若选中的浮线已消失则取消选中
  useEffect(() => {
    if (selectedKey && !floats.some((f) => floatKeyOf(f) === selectedKey)) {
      setSelectedKey(null)
    }
  }, [floats, selectedKey])

  // 画布尺寸缩小时夹紧已织行数
  useEffect(() => {
    setRevealed((n) => Math.min(n, state.settings.weftCount))
  }, [state.settings.weftCount])

  // 逐纬播放：每个节拍多织入一行；矩阵始终来自最新 state
  useEffect(() => {
    if (!playing) return
    if (revealed >= state.settings.weftCount) {
      setPlaying(false)
      return
    }
    timer.current = window.setTimeout(() => {
      setRevealed((n) => Math.min(n + 1, state.settings.weftCount))
    }, speedMs)
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [playing, revealed, speedMs, state.settings.weftCount])
  // 注意：state.matrix 变化不触发该 effect 重启，节拍仅由 revealed 推进；
  // 而 matrix 由 render 期 useMemo 重算，因此编辑后下一行立即使用最新组织。

  const editThreading = useCallback((unitIndex: number, harness: number) => {
    setState((s) => setThreadingCell(s, unitIndex, harness))
  }, [])
  const editTreadling = useCallback((unitIndex: number, treadle: number) => {
    setState((s) => setTreadlingCell(s, unitIndex, treadle))
  }, [])
  const editTie = useCallback((harness: number, treadle: number) => {
    setState((s) => toggleTieCell(s, harness, treadle))
  }, [])
  const changeSettings = useCallback((patch: Partial<DraftSettings>) => {
    setState((s) => updateSettings(s, patch))
  }, [])
  const resetToDefault = useCallback(() => {
    setState(createDefaultState())
    setSelectedKey(null)
    setRevealed(0)
    setPlaying(false)
  }, [])

  const play = useCallback(() => {
    setRevealed((n) => (n >= state.settings.weftCount ? 0 : n))
    setPlaying(true)
  }, [state.settings.weftCount])
  const pause = useCallback(() => setPlaying(false), [])
  const stepForward = useCallback(() => {
    setPlaying(false)
    setRevealed((n) => Math.min(n + 1, state.settings.weftCount))
  }, [state.settings.weftCount])
  const stepBack = useCallback(() => {
    setPlaying(false)
    setRevealed((n) => Math.max(0, n - 1))
  }, [])
  const resetPlayback = useCallback(() => {
    setPlaying(false)
    setRevealed(0)
  }, [])

  const selectedFloat = useMemo(
    () => floats.find((f) => floatKeyOf(f) === selectedKey) ?? null,
    [floats, selectedKey]
  )
  const selectFloat = setSelectedKey

  return {
    state,
    matrix,
    threadingExpanded,
    treadlingExpanded,
    floats,
    selectedKey,
    selectFloat,
    selectedFloat,
    editThreading,
    editTreadling,
    editTie,
    changeSettings,
    resetToDefault,
    revealed,
    playing,
    speedMs,
    setSpeedMs,
    play,
    pause,
    stepForward,
    stepBack,
    resetPlayback,
  }
}

/** 供 UI 高亮：把选中的浮线映射回穿综 / 踏纹 / 连接矩阵 */
export function useHighlights(
  selectedFloat: FloatRun | null,
  ctx: {
    threadingExpanded: readonly number[]
    treadlingExpanded: readonly number[]
    threadingRepeat: number
    treadlingRepeat: number
    tieUp: boolean[][]
  }
) {
  return useMemo(() => {
    const empty = {
      active: false,
      threadCols: new Set<number>(),
      threadUnits: new Set<number>(),
      treadRows: new Set<number>(),
      treadUnits: new Set<number>(),
      harnesses: new Set<number>(),
      treadles: new Set<number>(),
      tieCells: new Set<string>(),
      tieCandidates: new Set<string>(),
    }
    if (!selectedFloat) return empty
    const loc = locateFloat(selectedFloat, ctx)
    const tieCells = new Set<string>() // 实际连接（经浮线成因）
    const tieCandidates = new Set<string>() // 应提未提的空交点（纬浮线成因）
    for (const h of loc.harnesses) {
      for (const t of loc.treadles) {
        const key = `${h}-${t}`
        if (ctx.tieUp[h]?.[t]) {
          if (selectedFloat.kind === 'warp') tieCells.add(key)
        } else if (selectedFloat.kind === 'weft') {
          tieCandidates.add(key)
        }
      }
    }
    return {
      active: true,
      threadCols: new Set(loc.expandedCols),
      threadUnits: new Set(loc.threadingUnitCells),
      treadRows: new Set(loc.expandedRows),
      treadUnits: new Set(loc.treadlingUnitCells),
      harnesses: new Set(loc.harnesses),
      treadles: new Set(loc.treadles),
      tieCells,
      tieCandidates,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFloat, ctx.threadingExpanded, ctx.treadlingExpanded, ctx.tieUp])
}

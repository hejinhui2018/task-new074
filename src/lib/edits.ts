import type { DraftSettings, WeaveState } from './types'
import { resizeRepeat } from './repeat'

function cloneSettings(s: DraftSettings): DraftSettings {
  return { ...s }
}

/** 把综框/踏板索引夹到合法范围 */
function clampSeq(seq: readonly number[], mod: number): number[] {
  return seq.map((v) => (v >= 0 && v < mod ? v : 0))
}

/** 重设连接矩阵尺寸：新增行/列默认不连接 */
function resizeTieUp(tieUp: boolean[][], harnesses: number, treadles: number): boolean[][] {
  return Array.from({ length: harnesses }, (_, h) =>
    Array.from({ length: treadles }, (_, t) => tieUp[h]?.[t] === true)
  )
}

/**
 * 修改设置（尺寸 / 颜色 / 浮线阈值）。
 * 循环长度变化时按旧周期重采样；综框/踏板数变化时夹紧已有穿综、踏纹。
 */
export function updateSettings(state: WeaveState, patch: Partial<DraftSettings>): WeaveState {
  const settings = { ...cloneSettings(state.settings), ...patch }
  let threading = state.threading
  let treadling = state.treadling
  let tieUp = state.tieUp

  if (patch.threadingRepeat && patch.threadingRepeat !== state.settings.threadingRepeat) {
    threading = resizeRepeat(state.threading, settings.threadingRepeat)
  }
  if (patch.treadlingRepeat && patch.treadlingRepeat !== state.settings.treadlingRepeat) {
    treadling = resizeRepeat(state.treadling, settings.treadlingRepeat)
  }
  threading = clampSeq(threading, settings.harnessCount)
  treadling = clampSeq(treadling, settings.treadleCount)
  if (
    settings.harnessCount !== state.settings.harnessCount ||
    settings.treadleCount !== state.settings.treadleCount
  ) {
    tieUp = resizeTieUp(state.tieUp, settings.harnessCount, settings.treadleCount)
  }

  return { settings, threading, treadling, tieUp }
}

/** 修改穿综循环单元中第 index 根经纱所穿的综框 */
export function setThreadingCell(state: WeaveState, index: number, harness: number): WeaveState {
  if (index < 0 || index >= state.threading.length) return state
  if (harness < 0 || harness >= state.settings.harnessCount) return state
  if (state.threading[index] === harness) return state
  const threading = state.threading.slice()
  threading[index] = harness
  return { ...state, threading }
}

/** 修改踏纹循环单元中第 index 行纬纱所踩的踏板 */
export function setTreadlingCell(state: WeaveState, index: number, treadle: number): WeaveState {
  if (index < 0 || index >= state.treadling.length) return state
  if (treadle < 0 || treadle >= state.settings.treadleCount) return state
  if (state.treadling[index] === treadle) return state
  const treadling = state.treadling.slice()
  treadling[index] = treadle
  return { ...state, treadling }
}

/** 切换综框 h 与踏板 t 的连接 */
export function toggleTieCell(state: WeaveState, harness: number, treadle: number): WeaveState {
  if (harness < 0 || harness >= state.settings.harnessCount) return state
  if (treadle < 0 || treadle >= state.settings.treadleCount) return state
  const tieUp = state.tieUp.map((row) => row.slice())
  tieUp[harness][treadle] = !tieUp[harness][treadle]
  return { ...state, tieUp }
}

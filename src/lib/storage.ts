import type { WeaveState } from './types'
import { createDefaultState } from './defaultDraft'

const STORAGE_KEY = 'weave-design-bench:v1'

function numField(v: unknown, fallback: number, min = 1): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min ? Math.floor(v) : fallback
}

function intArray(v: unknown, len: number, mod: number, fallbackAt: (i: number) => number): number[] {
  const src = Array.isArray(v) ? v : []
  return Array.from({ length: len }, (_, i) => {
    const x = src[i]
    return typeof x === 'number' && x >= 0 && x < mod ? Math.floor(x) : fallbackAt(i)
  })
}

/** 从任意 JSON 数据校验并补全出一个合法状态；不合法时回退到内置样稿 */
export function coerceState(input: unknown): WeaveState {
  const d = createDefaultState()
  if (typeof input !== 'object' || input === null) return d
  const raw = input as Record<string, unknown>
  const s = raw.settings
  if (typeof s !== 'object' || s === null) return d
  const rs = s as Record<string, unknown>

  const settings: WeaveState['settings'] = {
    harnessCount: numField(rs.harnessCount, d.settings.harnessCount),
    treadleCount: numField(rs.treadleCount, d.settings.treadleCount),
    warpCount: numField(rs.warpCount, d.settings.warpCount),
    weftCount: numField(rs.weftCount, d.settings.weftCount),
    threadingRepeat: numField(rs.threadingRepeat, d.settings.threadingRepeat),
    treadlingRepeat: numField(rs.treadlingRepeat, d.settings.treadlingRepeat),
    maxFloat: numField(rs.maxFloat, d.settings.maxFloat, 0),
    warpColor: typeof rs.warpColor === 'string' && rs.warpColor ? rs.warpColor : d.settings.warpColor,
    weftColor: typeof rs.weftColor === 'string' && rs.weftColor ? rs.weftColor : d.settings.weftColor,
  }

  const threading = intArray(raw.threading, settings.threadingRepeat, settings.harnessCount, (i) =>
    d.threading[i % d.threading.length]
  )
  const treadling = intArray(raw.treadling, settings.treadlingRepeat, settings.treadleCount, (i) =>
    d.treadling[i % d.treadling.length]
  )

  const tieUp: boolean[][] = Array.from({ length: settings.harnessCount }, (_, h) =>
    Array.from({ length: settings.treadleCount }, (_, t) => {
      const row = Array.isArray(raw.tieUp) ? raw.tieUp[h] : undefined
      if (Array.isArray(row) && typeof row[t] === 'boolean') return row[t]
      // 尺寸变化导致越界时，新综框/踏板默认不连接
      return h < d.settings.harnessCount && t < d.settings.treadleCount ? d.tieUp[h][t] : false
    })
  )

  return { settings, threading, treadling, tieUp }
}

export function loadState(): WeaveState {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (!text) return createDefaultState()
    return coerceState(JSON.parse(text))
  } catch {
    return createDefaultState()
  }
}

export function saveState(state: WeaveState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 隐私模式或存储配额不足时静默失败，不影响设计
  }
}

export function clearSavedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}

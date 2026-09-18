import type { DraftSettings, WeaveState } from './types'

/**
 * 内置样稿：8 综 / 8 踏板 / 32 经 / 24 纬 破斜纹
 *
 * 采用断穿法（broken draft）：穿综顺序 1-4, 8-5，
 * 斜纹线在中段断开、反向，避免山形斜纹折点处的长浮线；
 * 踏纹顺踏 1-8；提综为 4/4 斜纹（每踏提起相邻 4 片综）。
 * 成品布面是人字棱纹、经纬最长浮线均为 4 的破斜纹。
 */
export function createDefaultState(): WeaveState {
  const harnessCount = 8
  const treadleCount = 8

  const settings: DraftSettings = {
    harnessCount,
    treadleCount,
    warpCount: 32,
    weftCount: 24,
    threadingRepeat: 8,
    treadlingRepeat: 8,
    maxFloat: 4,
    warpColor: '#8a5a33',
    weftColor: '#e8ddc8',
  }

  // 穿综循环（0 基）：1,2,3,4,8,7,6,5 —— 经典断穿
  const threading = [0, 1, 2, 3, 7, 6, 5, 4]

  // 踏纹循环（0 基）：顺踏 1..8
  const treadling = [0, 1, 2, 3, 4, 5, 6, 7]

  // 连接矩阵：踏板 t 提起 t, t+1, t+2, t+3（模 8），即 4/4 斜纹
  const tieUp: boolean[][] = Array.from({ length: harnessCount }, (_, h) =>
    Array.from({ length: treadleCount }, (_, t) => {
      const d = (h - t + harnessCount) % harnessCount
      return d <= 3
    })
  )

  return { settings, threading, treadling, tieUp }
}

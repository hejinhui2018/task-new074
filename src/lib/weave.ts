import type { WeaveMatrix, WeaveState } from './types'
import { expandRepeat } from './repeat'

/**
 * 计算整幅组织矩阵。
 *
 * 关系链：
 *   穿综单元（可循环）→ 展开到每一根经纱
 *   踏纹单元（可循环）→ 展开到每一行纬纱
 *   W[r][c] = tieUp[threading[c]][treadling[r]]
 *
 * 任一格（穿综 / 连接 / 踏纹）修改后都应重新调用本函数，
 * 这是“沿完整关系重新计算”的唯一入口。
 */
export function computeWeave(state: WeaveState): WeaveMatrix {
  const { settings, threading, treadling, tieUp } = state
  const warp = expandRepeat(threading, settings.warpCount)
  const weft = expandRepeat(treadling, settings.weftCount)

  const matrix: WeaveMatrix = []
  for (let r = 0; r < settings.weftCount; r++) {
    const treadle = weft[r]
    const row: (0 | 1)[] = new Array(settings.warpCount)
    for (let c = 0; c < settings.warpCount; c++) {
      row[c] = tieUp[warp[c]][treadle] ? 1 : 0
    }
    matrix.push(row)
  }
  return matrix
}

/** 展开后的逐经穿综序列（供 UI 与定位使用） */
export function expandedThreading(state: WeaveState): number[] {
  return expandRepeat(state.threading, state.settings.warpCount)
}

/** 展开后的逐纬踏板序列（供 UI 与播放使用） */
export function expandedTreadling(state: WeaveState): number[] {
  return expandRepeat(state.treadling, state.settings.weftCount)
}

/**
 * 逐纬试织预演：返回前 rowCount 行的布面。
 * rowCount 会被夹到 [0, weftCount]。编辑组织后重新调用，
 * 即可保证“从当前行继续”时使用最新组织。
 */
export function previewRows(state: WeaveState, rowCount: number): WeaveMatrix {
  const total = state.settings.weftCount
  const n = Math.max(0, Math.min(total, Math.floor(rowCount)))
  return computeWeave(state).slice(0, n)
}

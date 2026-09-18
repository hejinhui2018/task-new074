import type { WeaveMatrix } from './types'

/** 一段连续浮线 */
export interface FloatRun {
  /** warp = 经浮线（列向连续经浮点，经纱压过多根纬纱）；weft = 纬浮线（行向连续纬浮点） */
  kind: 'warp' | 'weft'
  /** 纬向（行）起始索引；weft 浮线即所在行，warp 浮线为起点行（wrap 时为尾段起点） */
  row: number
  /** 经向（列）起始索引；warp 浮线即所在列，weft 浮线为起点列（wrap 时为尾段起点） */
  col: number
  /** 连续浮线长度（连续格点数） */
  length: number
  /** 是否跨越循环接缝（首尾两段相接） */
  wrap: boolean
  /** 覆盖的全部格点（wrap 时为尾段 + 首段两部分） */
  cells: { r: number; c: number }[]
}

interface LinearRun {
  start: number
  end: number
  value: 0 | 1
}

/** 求一维 0/1 序列的全部极大连续段 */
function linearRuns(seq: readonly (0 | 1)[]): LinearRun[] {
  const runs: LinearRun[] = []
  if (seq.length === 0) return runs
  let start = 0
  for (let i = 1; i <= seq.length; i++) {
    if (i === seq.length || seq[i] !== seq[start]) {
      runs.push({ start, end: i - 1, value: seq[start] })
      start = i
    }
  }
  return runs
}

/**
 * 把首尾同值段按“织物循环铺贴”合并。
 * 穿综 / 踏纹按周期展开，因此组织图首尾相接，跨接缝的浮线真实存在。
 * 若整条序列同值（只有一段），它本身就是一段全长浮线，不重复计数。
 */
function mergeWrapping(runs: LinearRun[]): { run: LinearRun; wrap: boolean }[] {
  if (runs.length === 0) return []
  if (runs.length === 1) return [{ run: runs[0], wrap: false }]
  const first = runs[0]
  const last = runs[runs.length - 1]
  if (first.value !== last.value) return runs.map((run) => ({ run, wrap: false }))
  // 尾段（last.start..n-1）与首段（0..first.end）在循环铺贴时相接，合并为一段
  const merged: LinearRun = { start: last.start, end: first.end, value: first.value }
  const middle = runs.slice(1, -1).map((run) => ({ run, wrap: false }))
  return [{ run: merged, wrap: true }, ...middle]
}

/**
 * 检测组织图中所有超过 maxFloat 的连续浮线。
 * - 经浮线：每一列（一根经纱）上连续的经浮点 1，沿纬向（纵向）延伸
 * - 纬浮线：每一行（一根纬纱）上连续的纬浮点 0，沿经向（横向）延伸
 * 长度严格大于 maxFloat 才报警（等于上限允许）。
 */
export function detectFloats(matrix: WeaveMatrix, maxFloat: number): FloatRun[] {
  const rows = matrix.length
  const cols = rows > 0 ? matrix[0].length : 0
  const out: FloatRun[] = []
  if (rows === 0 || cols === 0) return out

  // 纬浮线：行内连续 0
  for (let r = 0; r < rows; r++) {
    const merged = mergeWrapping(linearRuns(matrix[r]))
    for (const { run, wrap } of merged) {
      if (run.value !== 0) continue
      const length = wrap ? cols - run.start + run.end + 1 : run.end - run.start + 1
      if (length <= maxFloat) continue
      const cells: { r: number; c: number }[] = []
      if (wrap) {
        for (let c = run.start; c < cols; c++) cells.push({ r, c })
        for (let c = 0; c <= run.end; c++) cells.push({ r, c })
      } else {
        for (let c = run.start; c <= run.end; c++) cells.push({ r, c })
      }
      out.push({ kind: 'weft', row: r, col: run.start, length, wrap, cells })
    }
  }

  // 经浮线：列内连续 1
  for (let c = 0; c < cols; c++) {
    const col: (0 | 1)[] = matrix.map((row) => row[c])
    const merged = mergeWrapping(linearRuns(col))
    for (const { run, wrap } of merged) {
      if (run.value !== 1) continue
      const length = wrap ? rows - run.start + run.end + 1 : run.end - run.start + 1
      if (length <= maxFloat) continue
      const cells: { r: number; c: number }[] = []
      if (wrap) {
        for (let r = run.start; r < rows; r++) cells.push({ r, c })
        for (let r = 0; r <= run.end; r++) cells.push({ r, c })
      } else {
        for (let r = run.start; r <= run.end; r++) cells.push({ r, c })
      }
      out.push({ kind: 'warp', row: run.start, col: c, length, wrap, cells })
    }
  }

  return out
}

/** 一段浮线的稳定标识（同一起点、方向、长度视为同一条） */
export function floatKeyOf(f: FloatRun): string {
  return `${f.kind}-${f.row}-${f.col}-${f.length}`
}

/** 一段浮线涉及的综框与踏板（用于在连接矩阵中定位交点） */
export interface FloatLocation {
  /** 穿综图（循环单元）中相关的位置索引；经浮线只有一个，纬浮线可能多个 */
  threadingUnitCells: number[]
  /** 踏纹图（循环单元）中相关的位置索引；纬浮线只有一个，经浮线可能多个 */
  treadlingUnitCells: number[]
  /** 展开后涉及的经纱列 */
  expandedCols: number[]
  /** 展开后涉及的纬纱行 */
  expandedRows: number[]
  /** 相关综框 */
  harnesses: number[]
  /** 相关踏板 */
  treadles: number[]
}

/**
 * 把一条浮线映射回它的“成因”位置：
 * - 经浮线（某根经纱连续被提起）→ 定位到该经纱的穿综格，以及参与的踏纹行
 * - 纬浮线（某根纬纱连续压过经纱）→ 定位到该纬纱的踏纹格，以及参与的穿综列
 */
export function locateFloat(
  float: FloatRun,
  ctx: {
    threadingExpanded: readonly number[]
    treadlingExpanded: readonly number[]
    threadingRepeat: number
    treadlingRepeat: number
  }
): FloatLocation {
  const { threadingExpanded, treadlingExpanded, threadingRepeat, treadlingRepeat } = ctx
  const cols = float.cells.map((p) => p.c)
  const rows = float.cells.map((p) => p.r)

  const expandedCols = float.kind === 'warp' ? [float.col] : Array.from(new Set(cols)).sort((a, b) => a - b)
  const expandedRows = float.kind === 'weft' ? [float.row] : Array.from(new Set(rows)).sort((a, b) => a - b)

  const threadingUnitCells =
    float.kind === 'warp'
      ? [float.col % threadingRepeat]
      : Array.from(new Set(expandedCols.map((c) => c % threadingRepeat))).sort((a, b) => a - b)
  const treadlingUnitCells =
    float.kind === 'weft'
      ? [float.row % treadlingRepeat]
      : Array.from(new Set(expandedRows.map((r) => r % treadlingRepeat))).sort((a, b) => a - b)

  const harnesses = Array.from(new Set(expandedCols.map((c) => threadingExpanded[c]))).sort((a, b) => a - b)
  const treadles = Array.from(new Set(expandedRows.map((r) => treadlingExpanded[r]))).sort((a, b) => a - b)

  return { threadingUnitCells, treadlingUnitCells, expandedCols, expandedRows, harnesses, treadles }
}

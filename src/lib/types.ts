/**
 * 织物组织设计台 —— 领域模型
 *
 * 四大图之间的关系（均为 0 基索引）：
 *   穿综 threading[e] = h         第 e 根经纱穿入第 h 片综框
 *   踏纹 treadling[r] = t        第 r 纬（行）踩下第 t 个踏板
 *   连接 tieUp[h][t] = 1/0       第 t 个踏板是否提起第 h 片综框
 *   组织 W[r][e] = tieUp[threading[e]][treadling[r]]
 *                  1 = 经浮点（经纱在上），0 = 纬浮点（纬纱在上）
 */

export interface DraftSettings {
  /** 综框数（内置样稿为 8） */
  harnessCount: number
  /** 踏板数（内置样稿为 8） */
  treadleCount: number
  /** 经纱根数（组织图列数） */
  warpCount: number
  /** 纬纱行数（组织图行数） */
  weftCount: number
  /** 穿综循环长度（穿综图编辑单元长度，按此循环铺满 warpCount 根经纱） */
  threadingRepeat: number
  /** 踏纹循环长度（踏纹图编辑单元长度，按此循环铺满 weftCount 行） */
  treadlingRepeat: number
  /** 允许的最大浮线长度，超过即报警 */
  maxFloat: number
  warpColor: string
  weftColor: string
}

export interface WeaveState {
  settings: DraftSettings
  /** 长度 = threadingRepeat，值为综框索引 */
  threading: number[]
  /** 长度 = treadlingRepeat，值为踏板索引 */
  treadling: number[]
  /** [综框][踏板] 是否连接 */
  tieUp: boolean[][]
}

/** 组织矩阵：[纬行][经列]，1 = 经浮于上 */
export type WeaveMatrix = (0 | 1)[][]

export interface CellPos {
  r: number
  c: number
}

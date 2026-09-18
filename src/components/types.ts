/** 浮线问题在各编辑图上的高亮集合 */
export interface Highlights {
  active: boolean
  /** 组织图 / 穿综图中相关的经纱列（展开后） */
  threadCols: Set<number>
  /** 穿综循环单元中相关的位置 */
  threadUnits: Set<number>
  /** 组织图 / 踏纹图中相关的纬纱行（展开后） */
  treadRows: Set<number>
  /** 踏纹循环单元中相关的位置 */
  treadUnits: Set<number>
  /** 相关综框 */
  harnesses: Set<number>
  /** 相关踏板 */
  treadles: Set<number>
  /** 经浮线成因：连接矩阵中实际提起综框的交点 "h-t"（红） */
  tieCells: Set<string>
  /** 纬浮线成因：连接矩阵中“应提未提”的空交点 "h-t"（琥珀，补上连接可消除纬浮线） */
  tieCandidates: Set<string>
}

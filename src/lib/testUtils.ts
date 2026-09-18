import type { WeaveState } from './types'

/** 测试用：快速构造一个状态 */
export function makeState(
  opts: {
    harnessCount?: number
    treadleCount?: number
    warpCount?: number
    weftCount?: number
    threadingRepeat?: number
    treadlingRepeat?: number
    maxFloat?: number
    threading?: number[]
    treadling?: number[]
    tieUp?: boolean[][]
  } = {}
): WeaveState {
  const harnessCount = opts.harnessCount ?? 4
  const treadleCount = opts.treadleCount ?? 4
  const warpCount = opts.warpCount ?? 8
  const weftCount = opts.weftCount ?? 8
  return {
    settings: {
      harnessCount,
      treadleCount,
      warpCount,
      weftCount,
      threadingRepeat: opts.threadingRepeat ?? opts.threading?.length ?? harnessCount,
      treadlingRepeat: opts.treadlingRepeat ?? opts.treadling?.length ?? treadleCount,
      maxFloat: opts.maxFloat ?? 3,
      warpColor: '#000000',
      weftColor: '#ffffff',
    },
    threading: opts.threading ?? [0, 1, 2, 3],
    treadling: opts.treadling ?? [0, 1, 2, 3],
    tieUp:
      opts.tieUp ??
      Array.from({ length: harnessCount }, (_, h) =>
        Array.from({ length: treadleCount }, (_, t) => h === t)
      ),
  }
}

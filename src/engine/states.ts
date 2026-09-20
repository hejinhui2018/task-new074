// 版本化状态结构：v1 → v5。每个版本一个 interface，老用户可能从任意版本回来。

export const MIN_VERSION = 1
export const LATEST_VERSION = 5

export interface V1Task {
  id: string
  title: string
  done: boolean
}

export interface V1State {
  version: 1
  user: { name: string }
  /** 已开启的面板，用 id 字符串数组表示 */
  panels: string[]
  tasks: V1Task[]
  /** v1 不约束取值，业务方写什么都行 */
  theme: string
}

export interface V2Task extends V1Task {
  /** v2 起任务可排序 */
  order: number
}

export interface V2State {
  version: 2
  user: { name: string; email: string | null }
  panels: { id: string; pinned: boolean }[]
  tasks: V2Task[]
  theme: 'light' | 'dark'
}

export interface V3Task {
  id: string
  title: string
  done: boolean
  order: number
  createdAt: string
}

export interface V3State {
  version: 3
  profile: { name: string; email: string | null; avatar: string }
  layout: { panels: { id: string; pinned: boolean }[]; sidebarCollapsed: boolean }
  /** v3 改为 id 索引，面板按 order 自行排序 */
  tasks: Record<string, V3Task>
  theme: 'light' | 'dark'
}

export type Priority = 'low' | 'normal' | 'high'

export interface V4Task extends V3Task {
  priority: Priority
}

export interface V4State {
  version: 4
  profile: V3State['profile'] & { emailVerified: boolean }
  layout: V3State['layout'] & { density: 'compact' | 'comfortable' }
  tasks: Record<string, V4Task>
  filters: { status: 'all' | 'open' | 'done' }[]
  theme: 'light' | 'dark'
}

export interface V5Task extends V4Task {
  tags: string[]
}

export interface V5State {
  version: 5
  profile: V4State['profile'] & { locale: string }
  layout: V4State['layout']
  tasks: Record<string, V5Task>
  filters: V4State['filters']
  theme: 'light' | 'dark' | 'system'
  updatedAt: string
}

export type VaultState = V1State | V2State | V3State | V4State | V5State

export const migrationId = (from: number, to: number): string => `${from}->${to}`

// ---- 出厂数据：模拟不同年代离开的用户 ----

export function factoryV1(): V1State {
  return {
    version: 1,
    user: { name: '林小北' },
    panels: ['inbox', 'calendar'],
    tasks: [
      { id: 't-1001', title: '整理周报', done: false },
      { id: 't-1002', title: '回复客户邮件', done: true },
      { id: 't-1003', title: '升级工作台', done: false },
    ],
    // 注意：v1 脏数据，主题写成了蓝色，v2 迁移必须归一化
    theme: 'blue',
  }
}

export function factoryV3(): V3State {
  return {
    version: 3,
    profile: { name: '周野', email: 'zhouye@example.com', avatar: '周' },
    layout: {
      panels: [
        { id: 'inbox', pinned: true },
        { id: 'metrics', pinned: false },
      ],
      sidebarCollapsed: true,
    },
    tasks: {
      't-2001': {
        id: 't-2001',
        title: '核对三季度账单',
        done: false,
        order: 1000,
        createdAt: '2024-03-01T08:00:00.000Z',
      },
      't-2002': {
        id: 't-2002',
        title: '迁移评审会议',
        done: false,
        order: 2000,
        createdAt: '2024-03-02T08:00:00.000Z',
      },
    },
    theme: 'dark',
  }
}

/** 模拟"未来版本"：当前客户端不认识 v7，只能降级只读打开 */
export function futureV7(): Record<string, unknown> {
  return {
    version: 7,
    profile: { name: '未来用户', email: 'future@example.com', avatar: '未', locale: 'ja-JP' },
    quantumLayout: { dock: 'right', neuralPanels: ['assistant'] },
    tasks: { 't-9001': { id: 't-9001', title: '来自未来的任务', done: false } },
    theme: 'system',
  }
}

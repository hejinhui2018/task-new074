import type { VaultState, V1State, V2State, V3State, V4State, V5State } from './states.ts'

// ---- 校验 ----

export interface ValidationIssue {
  path: string
  message: string
}

export interface Check {
  path: string
  description: string
  /** 返回 true 表示通过 */
  check: (s: unknown) => boolean
}

export interface MigrationContext {
  clock: () => string
}

export interface MigrationStep {
  from: number
  to: number
  title: string
  /** 这一步对数据做了什么（展示用） */
  changes: string[]
  /** 这一步失败后，旧做法会造成什么影响（展示用） */
  failureImpact: string
  /** 提交前对产物的校验规则 */
  outputChecks: Check[]
  transform: (input: never, ctx: MigrationContext) => VaultState
}

export const stepId = (from: number, to: number): string => `${from}->${to}`

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isIsoDate = (v: unknown): boolean =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))

// ---- 各版本"完整快照"校验：加载 / 刷新恢复时用 ----

const v1Checks: Check[] = [
  { path: 'version', description: 'version === 1', check: (s) => isObject(s) && s.version === 1 },
  { path: 'user.name', description: 'user.name 为非空字符串', check: (s) => isObject(s) && isObject(s.user) && typeof s.user.name === 'string' },
  { path: 'panels', description: 'panels 为字符串数组', check: (s) => isObject(s) && Array.isArray(s.panels) && s.panels.every((p) => typeof p === 'string') },
  {
    path: 'tasks',
    description: 'tasks 为 {id,title,done} 数组',
    check: (s) =>
      isObject(s) &&
      Array.isArray(s.tasks) &&
      s.tasks.every((t) => isObject(t) && typeof t.id === 'string' && typeof t.title === 'string' && typeof t.done === 'boolean'),
  },
]

const v2Checks: Check[] = [
  { path: 'version', description: 'version === 2', check: (s) => isObject(s) && s.version === 2 },
  { path: 'user.email', description: 'user.email 键存在（string|null）', check: (s) => isObject(s) && isObject(s.user) && ('email' in s.user) },
  {
    path: 'panels',
    description: 'panels 为 {id,pinned} 数组',
    check: (s) =>
      isObject(s) && Array.isArray(s.panels) &&
      s.panels.every((p) => isObject(p) && typeof p.id === 'string' && typeof p.pinned === 'boolean'),
  },
  {
    path: 'tasks[].order',
    description: '每个任务都有数字 order',
    check: (s) => isObject(s) && Array.isArray(s.tasks) && s.tasks.every((t) => isObject(t) && typeof t.order === 'number'),
  },
  { path: 'theme', description: 'theme ∈ light|dark', check: (s) => isObject(s) && (s.theme === 'light' || s.theme === 'dark') },
]

const v3Checks: Check[] = [
  { path: 'version', description: 'version === 3', check: (s) => isObject(s) && s.version === 3 },
  { path: 'profile.avatar', description: 'profile.avatar 为非空字符串', check: (s) => isObject(s) && isObject(s.profile) && typeof s.profile.avatar === 'string' && s.profile.avatar.length > 0 },
  { path: 'layout.sidebarCollapsed', description: 'layout.sidebarCollapsed 为布尔', check: (s) => isObject(s) && isObject(s.layout) && typeof s.layout.sidebarCollapsed === 'boolean' },
  {
    path: 'tasks',
    description: 'tasks 为 id 索引，且每项含 ISO createdAt',
    check: (s) =>
      isObject(s) && isObject(s.tasks) &&
      Object.values(s.tasks as Record<string, unknown>).every((t) => isObject(t) && t.id != null && isIsoDate(t.createdAt)),
  },
]

const v4Checks: Check[] = [
  { path: 'version', description: 'version === 4', check: (s) => isObject(s) && s.version === 4 },
  { path: 'profile.emailVerified', description: 'profile.emailVerified 为布尔', check: (s) => isObject(s) && isObject(s.profile) && typeof s.profile.emailVerified === 'boolean' },
  { path: 'layout.density', description: 'layout.density ∈ compact|comfortable', check: (s) => isObject(s) && isObject(s.layout) && (s.layout.density === 'compact' || s.layout.density === 'comfortable') },
  {
    path: 'tasks[].priority',
    description: '每个任务 priority ∈ low|normal|high',
    check: (s) => isObject(s) && isObject(s.tasks) && Object.values(s.tasks as Record<string, unknown>).every((t) => isObject(t) && ['low', 'normal', 'high'].includes(t.priority as string)),
  },
  { path: 'filters', description: 'filters 为数组', check: (s) => isObject(s) && Array.isArray(s.filters) },
]

const v5Checks: Check[] = [
  { path: 'version', description: 'version === 5', check: (s) => isObject(s) && s.version === 5 },
  { path: 'profile.locale', description: 'profile.locale 为非空字符串', check: (s) => isObject(s) && isObject(s.profile) && typeof s.profile.locale === 'string' && s.profile.locale.length > 0 },
  {
    path: 'tasks[].tags',
    description: '每个任务都有字符串数组 tags',
    check: (s) => isObject(s) && isObject(s.tasks) && Object.values(s.tasks as Record<string, unknown>).every((t) => isObject(t) && Array.isArray(t.tags) && t.tags.every((x) => typeof x === 'string')),
  },
  { path: 'theme', description: 'theme ∈ light|dark|system', check: (s) => isObject(s) && ['light', 'dark', 'system'].includes(s.theme as string) },
  { path: 'updatedAt', description: 'updatedAt 为 ISO 时间', check: (s) => isObject(s) && isIsoDate(s.updatedAt) },
]

export const snapshotChecks: Record<number, Check[]> = {
  1: v1Checks,
  2: v2Checks,
  3: v3Checks,
  4: v4Checks,
  5: v5Checks,
}

export function validateSnapshot(state: unknown): ValidationIssue[] {
  if (!isObject(state) || typeof state.version !== 'number') {
    return [{ path: '$', message: '不是合法的状态对象（缺少数字 version）' }]
  }
  const checks = snapshotChecks[state.version]
  if (!checks) return [{ path: 'version', message: `没有版本 ${state.version} 的校验规则` }]
  const issues: ValidationIssue[] = []
  for (const c of checks) {
    let ok = false
    try {
      ok = c.check(state)
    } catch {
      ok = false
    }
    if (!ok) issues.push({ path: c.path, message: c.description })
  }
  return issues
}

// ---- 迁移定义 ----

const migrations: MigrationStep[] = [
  {
    from: 1,
    to: 2,
    title: '用户与面板结构化、主题归一化',
    changes: [
      'user 拆分出 email（缺失置 null）',
      'panels: string[] → {id,pinned}[]，历史面板默认 pinned',
      'tasks 每项补 order（按数组下标 ×1000）',
      "脏 theme（如 'blue'）归一化为 'light'",
    ],
    failureImpact: '旧做法直接改写 panels/tasks：写到一半失败后，数组变成对象数组却缺 order，v1 页面读不出、v2 页面也读不出。',
    outputChecks: v2Checks,
    transform: (input: V1State): V2State => ({
      version: 2,
      user: { name: input.user.name, email: null },
      panels: input.panels.map((id, i) => ({ id, pinned: i === 0 })),
      tasks: input.tasks.map((t, i) => ({ ...t, order: (i + 1) * 1000 })),
      theme: input.theme === 'dark' ? 'dark' : 'light',
    }),
  },
  {
    from: 2,
    to: 3,
    title: 'profile/layout 重组、任务改 id 索引',
    changes: [
      'user → profile，并补 avatar（取名字首字）',
      'panels 收编进 layout，新增 sidebarCollapsed: false',
      'tasks 数组 → Record<id, task>，每项补 createdAt',
    ],
    failureImpact: '任务数组已转成字典、但 layout 还没写回时崩溃：首页任务列表与侧边栏同时白屏。',
    outputChecks: v3Checks,
    transform: (input: V2State, ctx): V3State => ({
      version: 3,
      profile: { name: input.user.name, email: input.user.email, avatar: input.user.name.slice(0, 1) || '?' },
      layout: { panels: input.panels, sidebarCollapsed: false },
      tasks: Object.fromEntries(
        input.tasks
          .slice()
          .sort((a, b) => a.order - b.order)
          .map((t) => [t.id, { ...t, createdAt: ctx.clock() }]),
      ),
      theme: input.theme,
    }),
  },
  {
    from: 3,
    to: 4,
    title: '任务优先级、密度与筛选器',
    changes: [
      '每个任务补 priority: "normal"',
      'profile 补 emailVerified: false',
      'layout 补 density: "comfortable"',
      '新增 filters: [{status:"all"}]',
    ],
    failureImpact: '新筛选器读 priority，旧任务没有该字段：升级中断后列表渲染直接抛 undefined 枚举。',
    outputChecks: v4Checks,
    transform: (input: V3State): V4State => ({
      version: 4,
      profile: { ...input.profile, emailVerified: false },
      layout: { ...input.layout, density: 'comfortable' },
      tasks: Object.fromEntries(
        Object.entries(input.tasks).map(([id, t]) => [id, { ...t, priority: 'normal' }]),
      ),
      filters: [{ status: 'all' }],
      theme: input.theme,
    }),
  },
  {
    from: 4,
    to: 5,
    title: '标签、多语言与系统主题',
    changes: [
      '每个任务补 tags: []',
      'profile 补 locale: "zh-CN"',
      'theme 放开 "system" 取值',
      '新增 updatedAt 时间戳',
    ],
    failureImpact: '新版标签栏依赖 tags；若只有部分任务拿到 tags，批量操作会漏掉一半数据且无任何报错提示。',
    outputChecks: v5Checks,
    transform: (input: V4State, ctx): V5State => ({
      version: 5,
      profile: { ...input.profile, locale: 'zh-CN' },
      layout: input.layout,
      tasks: Object.fromEntries(Object.entries(input.tasks).map(([id, t]) => [id, { ...t, tags: [] }])),
      filters: input.filters,
      theme: input.theme,
      updatedAt: ctx.clock(),
    }),
  },
]

export const migrationByFrom = new Map(migrations.map((m) => [m.from, m]))
export const allMigrations = migrations

export function planFrom(version: number, target: number): MigrationStep[] {
  const plan: MigrationStep[] = []
  let cur = version
  while (cur < target) {
    const step = migrationByFrom.get(cur)
    if (!step) break
    plan.push(step)
    cur = step.to
  }
  return plan
}

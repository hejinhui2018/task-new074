/**
 * 迁移表：相邻版本各一条，只能顺序执行。
 * 每条迁移包含 transform + validate，校验失败等同于迁移失败（不会提交半成品）。
 */
import {
  AnyState,
  LATEST_VERSION,
  MigrationDef,
  StateV0,
  StateV1,
  StateV2,
  StateV3,
  StateV4,
  StateV5,
  TaskV4,
  ValidationResult,
} from './types';

const ok = (): ValidationResult => ({ ok: true });
const bad = (...errors: string[]): ValidationResult => ({ ok: false, errors });

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/* --------------------------------- v0 → v1 --------------------------------- */

const m0to1: MigrationDef = {
  id: '0->1',
  from: 0,
  to: 1,
  title: '待办文本结构化为任务对象',
  changes: ['todos: string[] 映射为 tasks: {id,title,done}[]', '新增 version: 1', 'id 由序号生成 t{n}'],
  validationRules: ['tasks 必须是数组', '每个任务 id 非空且唯一', 'title 必须为字符串', 'done 必须为布尔值'],
  failureImpact: 'tasks 无法结构化：老版纯文本待办不会丢失，live 保持 v0 原样，半成品隔离待查。',
  up(input) {
    const s = input as StateV0;
    return {
      version: 1,
      user: s.user,
      theme: s.theme,
      notify: s.notify,
      tasks: (s.todos ?? []).map((title, i) => ({
        id: `t${i + 1}`,
        title: String(title),
        done: false,
      })),
    } satisfies StateV1;
  },
  validate(output) {
    if (!isObject(output) || output.version !== 1) return bad('缺少 version: 1');
    if (!Array.isArray(output.tasks)) return bad('tasks 不是数组');
    const errors: string[] = [];
    const ids = new Set<string>();
    (output.tasks as unknown[]).forEach((t, i) => {
      if (!isObject(t)) return errors.push(`tasks[${i}] 不是对象`);
      else {
        if (!isNonEmptyString(t.id)) errors.push(`tasks[${i}].id 为空`);
        else if (ids.has(t.id)) errors.push(`tasks[${i}].id 重复: ${t.id}`);
        ids.add(String(t.id));
        if (typeof t.title !== 'string') errors.push(`tasks[${i}].title 不是字符串`);
        if (typeof t.done !== 'boolean') errors.push(`tasks[${i}].done 不是布尔值`);
      }
    });
    return errors.length ? bad(...errors) : ok();
  },
};

/* --------------------------------- v1 → v2 --------------------------------- */

const m1to2: MigrationDef = {
  id: '1->2',
  from: 1,
  to: 2,
  title: '用户与外观设置收拢为档案',
  changes: ['user 改名为 profile.name', 'theme / notify 并入 profile', 'tasks 原样保留'],
  validationRules: ['profile 必须是对象', 'profile.name 为非空字符串', 'theme / notify 保留且类型正确', '旧字段 user / theme / notify 已移除'],
  failureImpact: '档案合并失败：profile 不会出现半旧半新，live 保持 v1。',
  up(input) {
    const s = input as StateV1;
    return {
      version: 2,
      profile: { name: s.user, theme: s.theme, notify: s.notify },
      tasks: s.tasks,
    } satisfies StateV2;
  },
  validate(output) {
    if (!isObject(output) || output.version !== 2) return bad('缺少 version: 2');
    const p = output.profile;
    if (!isObject(p)) return bad('profile 不是对象');
    const errors: string[] = [];
    if (!isNonEmptyString(p.name)) errors.push('profile.name 为空或不是字符串');
    if (typeof p.theme !== 'string') errors.push('profile.theme 不是字符串');
    if (typeof p.notify !== 'boolean') errors.push('profile.notify 不是布尔值');
    if (!Array.isArray(output.tasks)) errors.push('tasks 不是数组');
    if ('user' in output || 'theme' in output || 'notify' in output)
      errors.push('旧字段 user/theme/notify 未清理');
    return errors.length ? bad(...errors) : ok();
  },
};

/* --------------------------------- v2 → v3 --------------------------------- */

const m2to3: MigrationDef = {
  id: '2->3',
  from: 2,
  to: 3,
  title: '设置独立成块，任务补时间戳',
  changes: ['profile 拆为 profile.name + settings.{theme,notifications}', 'notify 更名 notifications', '每个任务补 createdAt', '新增 updatedAt'],
  validationRules: ['settings.theme / settings.notifications 类型正确', '每个任务 createdAt 为有限数字', 'updatedAt 为有限数字', 'profile 仅含 name'],
  failureImpact: '设置块或时间戳不完整时拒绝提交，live 保持 v2（不会出现没有 createdAt 的 v3 任务）。',
  up(input, ctx) {
    const s = input as StateV2;
    const now = ctx.clock();
    return {
      version: 3,
      profile: { name: s.profile.name },
      settings: { theme: s.profile.theme, notifications: s.profile.notify },
      tasks: s.tasks.map((t) => ({ ...t, createdAt: now })),
      updatedAt: now,
    } satisfies StateV3;
  },
  validate(output) {
    if (!isObject(output) || output.version !== 3) return bad('缺少 version: 3');
    const errors: string[] = [];
    const settings = output.settings;
    if (!isObject(settings)) errors.push('settings 不是对象');
    else {
      if (typeof settings.theme !== 'string') errors.push('settings.theme 不是字符串');
      if (typeof settings.notifications !== 'boolean') errors.push('settings.notifications 不是布尔值');
    }
    const profile = output.profile;
    if (!isObject(profile) || !isNonEmptyString(profile.name)) errors.push('profile.name 非法');
    if (!Array.isArray(output.tasks)) errors.push('tasks 不是数组');
    else
      (output.tasks as unknown[]).forEach((t, i) => {
        if (isObject(t) && !Number.isFinite(t.createdAt))
          errors.push(`tasks[${i}].createdAt 不是有限数字`);
      });
    if (!Number.isFinite(output.updatedAt)) errors.push('updatedAt 不是有限数字');
    return errors.length ? bad(...errors) : ok();
  },
};

/* --------------------------------- v3 → v4 --------------------------------- */

const m3to4: MigrationDef = {
  id: '3->4',
  from: 3,
  to: 4,
  title: 'done 布尔升级为状态机并引入标签',
  changes: ['删除 done', 'status: done ? "done" : "todo"', '新增 tags: []'],
  validationRules: ['status 只能是 todo / doing / done', 'tags 必须是字符串数组', 'done 字段已删除', 'createdAt 保留'],
  failureImpact: '状态机非法时整步回滚，live 保持 v3；绝不允许同一任务同时带 done 和 status。',
  up(input) {
    const s = input as StateV3;
    return {
      version: 4,
      profile: s.profile,
      settings: s.settings,
      updatedAt: s.updatedAt,
      tasks: s.tasks.map(({ done, ...rest }) => ({
        ...rest,
        status: done ? 'done' : ('todo' as TaskV4['status']),
        tags: [],
      })),
    } satisfies StateV4;
  },
  validate(output) {
    if (!isObject(output) || output.version !== 4) return bad('缺少 version: 4');
    if (!Array.isArray(output.tasks)) return bad('tasks 不是数组');
    const errors: string[] = [];
    const allowed = new Set(['todo', 'doing', 'done']);
    (output.tasks as unknown[]).forEach((t, i) => {
      if (!isObject(t)) return errors.push(`tasks[${i}] 不是对象`);
      if (!allowed.has(t.status as string)) errors.push(`tasks[${i}].status 非法: ${String(t.status)}`);
      if (!Array.isArray(t.tags) || t.tags.some((x) => typeof x !== 'string'))
        errors.push(`tasks[${i}].tags 不是字符串数组`);
      if ('done' in t) errors.push(`tasks[${i}] 仍残留 done 字段`);
      if (!Number.isFinite(t.createdAt)) errors.push(`tasks[${i}].createdAt 丢失`);
    });
    return errors.length ? bad(...errors) : ok();
  },
};

/* --------------------------------- v4 → v5 --------------------------------- */

const m4to5: MigrationDef = {
  id: '4->5',
  from: 4,
  to: 5,
  title: '工作台信封 + 任务字典',
  changes: ['profile / settings 包进 workbench', '新增 workbench.id', 'tasks 数组改为 tasks 字典 + order 顺序表'],
  validationRules: ['workbench.id 非空', 'order 与 tasks 键集合完全一致', 'order 无重复 id', '旧 tasks 数组字段已移除'],
  failureImpact: '字典与顺序表不一致会导致任务“消失”，校验拦截，live 保持 v4。',
  up(input, ctx) {
    const s = input as StateV4;
    const tasks: StateV5['tasks'] = {};
    const order: string[] = [];
    for (const t of s.tasks) {
      tasks[t.id] = t;
      order.push(t.id);
    }
    return {
      version: 5,
      workbench: {
        id: `wb-${ctx.clock().toString(36)}`,
        profile: s.profile,
        settings: s.settings,
      },
      tasks,
      order,
      updatedAt: s.updatedAt,
    } satisfies StateV5;
  },
  validate(output) {
    if (!isObject(output) || output.version !== 5) return bad('缺少 version: 5');
    const errors: string[] = [];
    const wb = output.workbench;
    if (!isObject(wb)) errors.push('workbench 不是对象');
    else if (!isNonEmptyString(wb.id)) errors.push('workbench.id 为空');
    const tasks = output.tasks;
    const order = output.order;
    if (!isObject(tasks)) errors.push('tasks 不是字典');
    if (!Array.isArray(order)) errors.push('order 不是数组');
    if (isObject(tasks) && Array.isArray(order)) {
      const keys = new Set(Object.keys(tasks));
      const seen = new Set<string>();
      for (const id of order) {
        if (typeof id !== 'string') {
          errors.push('order 中存在非字符串 id');
          continue;
        }
        if (seen.has(id)) errors.push(`order 中 id 重复: ${id}`);
        seen.add(id);
        if (!keys.has(id)) errors.push(`order 引用了不存在的任务: ${id}`);
      }
      for (const k of keys) if (!seen.has(k)) errors.push(`tasks 中的任务未进入 order: ${k}`);
    }
    return errors.length ? bad(...errors) : ok();
  },
};

export const MIGRATIONS: MigrationDef[] = [m0to1, m1to2, m2to3, m3to4, m4to5];

const BY_ID = new Map(MIGRATIONS.map((m) => [m.id, m]));
export const getMigration = (id: string): MigrationDef | undefined => BY_ID.get(id);

/** 计算从当前版本到目标版本的迁移计划（相邻版本，不允许跳级） */
export function planMigrations(fromVersion: number, target: number = LATEST_VERSION): MigrationDef[] {
  const plan: MigrationDef[] = [];
  let v = fromVersion;
  while (v < target) {
    const m = MIGRATIONS.find((x) => x.from === v);
    if (!m) throw new Error(`没有从 v${v} 出发的迁移路径`);
    plan.push(m);
    v = m.to;
  }
  return plan;
}

/** 任意存档的版本探测：v0 没有 version 字段 */
export function detectVersion(state: unknown): number | null {
  if (!isObject(state)) return null;
  if (!('version' in state)) {
    // v0 特征字段
    if (Array.isArray(state.todos) && typeof state.user === 'string') return 0;
    return null;
  }
  const v = state.version;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LATEST_VERSION ? v : null;
}

/** 校验处于指定版本的存档（迁移的 validate 校验的是“输出”，故按 to 查找） */
export function validateStateAtVersion(version: number, state: unknown): ValidationResult {
  if (version === 0) return validateV0(state);
  const produced = MIGRATIONS.find((m) => m.to === version);
  return produced ? produced.validate(state) : bad(`未知版本 v${version}`);
}

function validateV0(state: unknown): ValidationResult {
  if (!isObject(state)) return bad('v0 存档不是对象');
  const errors: string[] = [];
  if (typeof state.user !== 'string') errors.push('user 不是字符串');
  if (!Array.isArray(state.todos) || state.todos.some((t) => typeof t !== 'string'))
    errors.push('todos 不是字符串数组');
  if (typeof state.theme !== 'string') errors.push('theme 不是字符串');
  if (typeof state.notify !== 'boolean') errors.push('notify 不是布尔值');
  return errors.length ? bad(...errors) : ok();
}

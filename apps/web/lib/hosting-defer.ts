/**
 * 队列延后：以某条目为起点，把它及其之后的全部条目顺延
 *
 * 两个独立维度：
 *   - 按天（planDeferByDays）：每个条目各自 +N 个「可用日」
 *   - 按次（planDeferByOccurrences）：沿已占用的时间线平移 N 个槽位
 *
 * 「可用日」= 未请假，且（非固休 或 固休但已有安排）的日期。
 * 按可用日推进而非自然日，否则条目会落在固休/请假日上，等于没遵守规则。
 *
 * 固休的优先级低于延后：固休日一旦已有安排，就按正常排期日参与计算。
 * 占用情况取延后前的快照（「延期时固休日有安排」），不随移动过程变化 ——
 * 否则一边移动一边改变可用性，结果不可预测。
 *
 * 该规则同时保证映射是单射：每个源日期都有条目、因而都可用，
 * 按可用日推进严格保序，不会把两个源日期压到同一天。
 *
 * 纯函数，无 IO。服务端会重新校验结果，客户端算出的 plan 不可信。
 */

import { addDaysIso, normalizeRoleName } from './hosting-todo-schedule';
import { isWeeklyRestDate, type IsoWeekday } from './hosting-rest-days';

export type DeferRow = {
  id: number;
  todoDate: string;
  roleName: string;
  sortOrder: number;
};

export type DeferOptions = {
  restDays: IsoWeekday[];
  leaveDates: Set<string>;
  /**
   * 延后前已有安排的日期（快照）。命中的固休日视为正常排期日。
   * 由 planDefer* 内部按 allRows 自动填充，调用方无需传。
   */
  occupiedDates?: Set<string>;
  /** 安全上限：固休+请假占满所有日期时防止死循环 */
  maxProbeDays?: number;
};

export type DeferMove = { id: number; fromDate: string; toDate: string };

export type DeferPlan = {
  moves: DeferMove[];
  /** 受影响条目数（含日期未变的） */
  affectedCount: number;
  /** 延后后出现多个条目的日期数 */
  crowdedDays: number;
  originalRange: { from: string; to: string } | null;
  nextRange: { from: string; to: string } | null;
  /** 有值表示无法求解，UI 直接展示、不提交 */
  error?: string;
};

const DEFAULT_MAX_PROBE_DAYS = 400;

/**
 * n 的上限。maxProbeDays 只是单次探测预算，总工作量是 n × maxProbeDays，
 * 不设上限时 n=1000000 会把主线程卡死几十秒。
 */
export const MAX_DEFER_N = 365;

/** 服务端 bulk-move 的单次上限，提前在预览阶段拦住，避免确认后才失败 */
export const MAX_DEFER_MOVES = 500;

function emptyPlan(error?: string): DeferPlan {
  return { moves: [], affectedCount: 0, crowdedDays: 0, originalRange: null, nextRange: null, error };
}

function isAvailable(iso: string, o: DeferOptions): boolean {
  // 请假是硬约束，固休让位于「已有安排」
  if (o.leaveDates.has(iso)) return false;
  if (!isWeeklyRestDate(iso, o.restDays)) return true;
  return o.occupiedDates?.has(iso) === true;
}

/** 延后前的占用快照：固休日是否按正常排期日参与计算，取决于此 */
function occupiedSnapshot(rows: DeferRow[]): Set<string> {
  return new Set(rows.map(r => r.todoDate));
}

/** afterIso 之后的第一个可用日；探测超限返回 null */
export function nextAvailableDate(afterIso: string, o: DeferOptions): string | null {
  const limit = o.maxProbeDays ?? DEFAULT_MAX_PROBE_DAYS;
  for (let i = 1; i <= limit; i++) {
    const d = addDaysIso(afterIso, i);
    if (isAvailable(d, o)) return d;
  }
  return null;
}

/** 从 fromIso 往后数 steps 个可用日 */
function advanceAvailableDays(fromIso: string, steps: number, o: DeferOptions): string | null {
  let cur = fromIso;
  for (let i = 0; i < steps; i++) {
    const nxt = nextAvailableDate(cur, o);
    if (!nxt) return null;
    cur = nxt;
  }
  return cur;
}

/** 按 (日期, 顺序, id) 排成全局时间线 */
function sortTimeline(rows: DeferRow[]): DeferRow[] {
  return [...rows].sort(
    (a, b) => a.todoDate.localeCompare(b.todoDate) || a.sortOrder - b.sortOrder || a.id - b.id,
  );
}

/** 延后后同一天出现同名角色 → 阻止提交（一周内重复不拦，批量延后必然大量触发） */
function detectSameDayDuplicate(
  rows: DeferRow[],
  moveMap: Map<number, string>,
): string | null {
  const seen = new Map<string, Set<string>>();
  for (const r of rows) {
    const date = moveMap.get(r.id) ?? r.todoDate;
    const role = normalizeRoleName(r.roleName);
    if (!role) continue;
    let bucket = seen.get(date);
    if (!bucket) {
      bucket = new Set();
      seen.set(date, bucket);
    }
    if (bucket.has(role)) return `延后后 ${date} 会出现「${r.roleName}」重复，请先调整该日安排`;
    bucket.add(role);
  }
  return null;
}

function summarize(
  affected: DeferRow[],
  moveMap: Map<number, string>,
  allRows: DeferRow[],
): Pick<DeferPlan, 'moves' | 'affectedCount' | 'crowdedDays' | 'originalRange' | 'nextRange'> {
  const moves: DeferMove[] = [];
  for (const r of affected) {
    const toDate = moveMap.get(r.id);
    if (toDate && toDate !== r.todoDate) moves.push({ id: r.id, fromDate: r.todoDate, toDate });
  }

  const origDates = affected.map(r => r.todoDate).sort();
  const nextDates = affected.map(r => moveMap.get(r.id) ?? r.todoDate).sort();

  // 拥挤统计基于延后后的全量分布，而非仅受影响条目
  const countByDate = new Map<string, number>();
  for (const r of allRows) {
    const d = moveMap.get(r.id) ?? r.todoDate;
    countByDate.set(d, (countByDate.get(d) ?? 0) + 1);
  }
  let crowdedDays = 0;
  for (const n of countByDate.values()) if (n > 1) crowdedDays++;

  return {
    moves,
    affectedCount: affected.length,
    crowdedDays,
    originalRange: origDates.length ? { from: origDates[0], to: origDates[origDates.length - 1] } : null,
    nextRange: nextDates.length ? { from: nextDates[0], to: nextDates[nextDates.length - 1] } : null,
  };
}

/**
 * 按天延后：受影响条目各自 +n 个可用日
 *
 * 副作用：原本分散的条目可能被压到同一天（可用日映射不保序）。
 * 由 crowdedDays 暴露给 UI，不静默处理。
 */
export function planDeferByDays(
  allRows: DeferRow[],
  anchorId: number,
  n: number,
  o: DeferOptions,
): DeferPlan {
  if (!Number.isInteger(n) || n < 1) return emptyPlan('延后天数须为 ≥ 1 的整数');
  if (n > MAX_DEFER_N) return emptyPlan(`延后天数不能超过 ${MAX_DEFER_N}`);

  const timeline = sortTimeline(allRows);
  const k = timeline.findIndex(r => r.id === anchorId);
  if (k < 0) return emptyPlan('起点条目不存在，请刷新后重试');

  const opts: DeferOptions = { ...o, occupiedDates: o.occupiedDates ?? occupiedSnapshot(allRows) };
  const affected = timeline.slice(k);
  const moveMap = new Map<number, string>();
  // 同一源日期映射到同一目标日期，避免同日条目被拆散
  const dateCache = new Map<string, string>();

  for (const r of affected) {
    let target = dateCache.get(r.todoDate);
    if (target === undefined) {
      const t = advanceAvailableDays(r.todoDate, n, opts);
      if (!t) return emptyPlan('可用日不足（固休与请假占满了后续日期），无法延后');
      target = t;
      dateCache.set(r.todoDate, target);
    }
    moveMap.set(r.id, target);
  }

  const dup = detectSameDayDuplicate(allRows, moveMap);
  if (dup) return emptyPlan(dup);

  const plan = summarize(affected, moveMap, allRows);
  if (plan.moves.length > MAX_DEFER_MOVES) {
    return emptyPlan(`本次将改期 ${plan.moves.length} 个条目，超过单次上限 ${MAX_DEFER_MOVES}，请选更靠后的节点`);
  }
  return plan;
}

/**
 * 按次延后：沿已占用的时间线平移 n 个槽位
 *
 * 把受影响条目原本占用的日期序列展开成槽位（保留每日条目数），
 * 末尾按需追加新可用日，然后整条切片右移 n 格。
 *
 * 例：10-26[A,B] 10-27[C] 10-29[D]，以 A 为起点延后 1 次
 *     槽位 A B C D → _ A B C D（需 5 槽，原 4 槽，追加 10-30）
 *     结果 10-26[B] 10-27[A] 10-29[C] 10-30[D]
 */
export function planDeferByOccurrences(
  allRows: DeferRow[],
  anchorId: number,
  n: number,
  o: DeferOptions,
): DeferPlan {
  if (!Number.isInteger(n) || n < 1) return emptyPlan('延后次数须为 ≥ 1 的整数');
  if (n > MAX_DEFER_N) return emptyPlan(`延后次数不能超过 ${MAX_DEFER_N}`);

  const timeline = sortTimeline(allRows);
  const k = timeline.findIndex(r => r.id === anchorId);
  if (k < 0) return emptyPlan('起点条目不存在，请刷新后重试');

  const opts: DeferOptions = { ...o, occupiedDates: o.occupiedDates ?? occupiedSnapshot(allRows) };
  const affected = timeline.slice(k);
  const m = affected.length;

  // 受影响条目占用的日期序列（去重保序）+ 每日容量
  const dateOrder: string[] = [];
  const capacity = new Map<string, number>();
  for (const r of affected) {
    const c = capacity.get(r.todoDate);
    if (c === undefined) {
      dateOrder.push(r.todoDate);
      capacity.set(r.todoDate, 1);
    } else {
      capacity.set(r.todoDate, c + 1);
    }
  }

  // 槽位序列：原日期按容量展开
  const slots: string[] = [];
  for (const d of dateOrder) {
    const cap = capacity.get(d) ?? 0;
    for (let i = 0; i < cap; i++) slots.push(d);
  }

  // 追加新可用日直到槽位数 ≥ m + n。新日容量取原日期的平均占用（向上取整），
  // 使追加段的密度与现有排期一致，而非每天只排 1 条。
  const avgPerDay = Math.max(1, Math.ceil(m / Math.max(dateOrder.length, 1)));
  let last = dateOrder.length ? dateOrder[dateOrder.length - 1] : affected[0].todoDate;
  while (slots.length < m + n) {
    const nxt = nextAvailableDate(last, opts);
    if (!nxt) return emptyPlan('可用日不足（固休与请假占满了后续日期），无法延后');
    for (let i = 0; i < avgPerDay && slots.length < m + n; i++) slots.push(nxt);
    last = nxt;
  }

  // 切片右移 n 格
  const moveMap = new Map<number, string>();
  for (let i = 0; i < m; i++) {
    const target = slots[i + n];
    if (!target) return emptyPlan('槽位计算异常，请重试');
    moveMap.set(affected[i].id, target);
  }

  const dup = detectSameDayDuplicate(allRows, moveMap);
  if (dup) return emptyPlan(dup);

  const plan = summarize(affected, moveMap, allRows);
  if (plan.moves.length > MAX_DEFER_MOVES) {
    return emptyPlan(`本次将改期 ${plan.moves.length} 个条目，超过单次上限 ${MAX_DEFER_MOVES}，请选更靠后的节点`);
  }
  return plan;
}

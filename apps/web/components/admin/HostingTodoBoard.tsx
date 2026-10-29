'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAdminCaptainsList } from '@/lib/admin-captains-list';
import { T9_GROUP_KEYS, T9_GROUP_LABEL, preloadPinyinPro, t9GroupKeyForDisplayName } from '@/lib/captain-t9-group';
import type { CaptainApiDto } from '@/lib/captain-dto';
import { captainAvatarImgReferrerPolicy, captainAvatarImgSrc } from '@/lib/captain-avatar-placeholder';
import { captainPoolDisplayLine, captainScheduleName } from '@/lib/captain-schedule-name';
import { addDaysIso, analyzeRoleScheduleConflict } from '@/lib/hosting-todo-schedule';
import {
  WEEKDAY_OPTIONS,
  formatRestDaysLabel,
  isWeeklyRestDate,
  parseWeeklyRestDays,
  type IsoWeekday,
} from '@/lib/hosting-rest-days';
import {
  MAX_DEFER_N,
  planDeferByDays,
  planDeferByOccurrences,
  type DeferPlan,
  type DeferRow,
} from '@/lib/hosting-defer';
import {
  isoDatesCurrentWeek,
  mondayIsoOfWeekContaining,
  monthCalendarGrid,
  parseIsoDateParts,
  todayIsoDate,
  weekdayLabel,
} from '@/lib/hosting-week-utils';
import { DEFAULT_HOST_TYPE, HOST_TYPE_LABEL, HOST_TYPES, isHostType, type HostType } from '@/lib/hosting-types';
import { compareZhDisplayName, dataTransferTypeList } from '@/lib/locale-compare';

/** 从舰长池拖入新建条目时的默认参数（生成后可在卡片上改托管类型 / 卡任务） */
const DRAG_IN_HOST_TYPE = DEFAULT_HOST_TYPE;
const DRAG_IN_STUCK = false;

export type HostingTodoDto = {
  id: number;
  todoDate: string;
  roleName: string;
  hostType: string;
  stuckTask: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

/** 左侧大数字日 + 年月行 */
function parseMissionDate(iso: string) {
  if (!iso || typeof iso !== 'string') {
    return { dayNum: '--', ym: '', wd: '' };
  }
  const [y, m, day] = iso.split('-').map(Number);
  return {
    dayNum: day ? String(day).padStart(2, '0') : '--',
    ym: y && m ? `${y}.${String(m).padStart(2, '0')}` : '',
    wd: weekdayLabel(iso),
  };
}

function normalizeHostingTodo(raw: unknown): HostingTodoDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id);
  const todoDate = typeof o.todoDate === 'string' ? o.todoDate.trim() : '';
  const roleName = typeof o.roleName === 'string' ? o.roleName : '';
  if (!Number.isFinite(id) || !todoDate) return null;
  return {
    id,
    todoDate,
    roleName,
    hostType: typeof o.hostType === 'string' ? o.hostType : DEFAULT_HOST_TYPE,
    stuckTask: Boolean(o.stuckTask),
    sortOrder: Number(o.sortOrder) || 0,
    createdAt: Number(o.createdAt) || 0,
    updatedAt: Number(o.updatedAt) || 0,
  };
}

function normalizeCaptain(raw: unknown): CaptainApiDto | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = Number(o.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    uid: typeof o.uid === 'string' ? o.uid : '',
    idName: typeof o.idName === 'string' ? o.idName : null,
    remarkName: typeof o.remarkName === 'string' ? o.remarkName : null,
    note: typeof o.note === 'string' ? o.note : null,
    wechatRemark: typeof o.wechatRemark === 'string' ? o.wechatRemark : null,
    gameIdRemark: typeof o.gameIdRemark === 'string' ? o.gameIdRemark : null,
    shipTier: typeof o.shipTier === 'string' ? o.shipTier : null,
    shipTierLabel: typeof o.shipTierLabel === 'string' ? o.shipTierLabel : null,
    shippedAt: o.shippedAt == null ? null : Number(o.shippedAt),
    expiresAt: o.expiresAt == null ? null : Number(o.expiresAt),
    expireStatus:
      o.expireStatus === 'active' || o.expireStatus === 'expired' || o.expireStatus === 'none' ? o.expireStatus : 'none',
    daysRemaining: o.daysRemaining == null ? null : Number(o.daysRemaining),
    avatarUrl: typeof o.avatarUrl === 'string' ? o.avatarUrl : null,
    createdAt: Number(o.createdAt) || 0,
    updatedAt: Number(o.updatedAt) || 0,
  };
}

function reorderIds(ids: number[], dragId: number, targetId: number, place: 'before' | 'after') {
  const arr = [...ids];
  const di = arr.indexOf(dragId);
  const ti = arr.indexOf(targetId);
  if (di < 0 || ti < 0 || di === ti) return arr;
  arr.splice(di, 1);
  const ti2 = arr.indexOf(targetId);
  const insert = place === 'before' ? ti2 : ti2 + 1;
  arr.splice(insert, 0, dragId);
  return arr;
}

/** 任务板风格色板 */
const th = {
  page: 'bg-[#080a0d] text-[#d4cfc4]',
  panel: 'bg-[#0f1218] border border-[#1e2633]',
  rail: 'bg-[#0a0c10]',
  line: 'border-[#1a2230]',
  muted: 'text-[#6d7684]',
  gold: 'text-[#c8aa6e]',
  goldBg: 'bg-[#c8aa6e]/12',
  goldBorder: 'border-[#c8aa6e]/35',
  input:
    'rounded border border-[#2a3344] bg-[#0a0d12] px-2.5 py-2 text-sm text-[#e4dfd4] outline-none placeholder:text-[#4a5568] focus:border-[#c8aa6e]/60 focus:ring-1 focus:ring-[#c8aa6e]/25',
  btn: 'rounded border border-[#c8aa6e]/40 bg-[#c8aa6e]/15 px-4 py-2 text-sm font-medium text-[#c8aa6e] transition hover:bg-[#c8aa6e]/25 disabled:opacity-40',
  btnGhost: 'rounded border border-[#2a3344] bg-transparent px-3 py-2 text-sm text-[#9aa5b4] transition hover:border-[#3d4a5f] hover:text-[#c8aa6e] disabled:opacity-40',
  card: 'group relative border border-[#232b38] bg-gradient-to-r from-[#12161f] to-[#0e1118] transition hover:border-[#c8aa6e]/25',
  cardAccent: 'border-l-[3px] border-l-[#c8aa6e]',
  toastOk: 'border border-emerald-800/60 bg-emerald-950/40 text-emerald-200',
  toastErr: 'border border-red-900/50 bg-red-950/40 text-red-200',
};

function CollapseChevron({ open, className = '', size = 'md' }: { open: boolean; className?: string; size?: 'sm' | 'md' }) {
  const sz = size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4';
  return (
    <svg
      aria-hidden
      className={`${sz} shrink-0 text-[#c8aa6e] transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'} ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2">
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ApiErrJson = { error?: string; code?: string; requiresConfirm?: boolean };

type PendingWeek =
  | { kind: 'post'; body: { todoDate: string; roleName: string; hostType: string; stuckTask: boolean; captainId?: number } }
  | { kind: 'put'; id: number; body: Record<string, unknown> };

function toSchedulingRows(list: HostingTodoDto[]) {
  return list.map(r => ({ id: r.id, todo_date: r.todoDate, role_name: r.roleName }));
}

const MIME_HOSTING = 'application/x-feiyan-hosting';
const MIME_CAPTAIN = 'application/x-feiyan-hosting-captain';

/** 拖入固休日的确认：「今日不再提醒」存当天日期，跨日天然失效 */
const REST_SUPPRESS_KEY = 'feiyan.restDropSuppressedOn';

function readRestDropSuppressed(todayIso: string): boolean {
  try {
    return window.sessionStorage.getItem(REST_SUPPRESS_KEY) === todayIso;
  } catch {
    // 隐私模式等场景会抛；读不到就当未抑制，仍然弹窗（安全的默认）
    return false;
  }
}

function writeRestDropSuppressed(todayIso: string) {
  try {
    window.sessionStorage.setItem(REST_SUPPRESS_KEY, todayIso);
  } catch {
    /* 存不下就只在本次会话内存里生效 */
  }
}

/** 落到固休日的待确认操作：新建（舰长池拖入）或改期（条目跨日拖动） */
type PendingRestDrop =
  | { kind: 'create'; targetDate: string; roleName: string; captainId?: number }
  | { kind: 'move'; targetDate: string; id: number; roleName: string };

/** 右键菜单：锚点条目 + 视口坐标 */
type QueueMenu = { item: HostingTodoDto; x: number; y: number };

/** 延后预览：算好的方案 + 用于文案的维度描述 */
type DeferPreview = { plan: DeferPlan; anchorName: string; label: string };

function toDeferRows(list: HostingTodoDto[]): DeferRow[] {
  return list.map(r => ({ id: r.id, todoDate: r.todoDate, roleName: r.roleName, sortOrder: r.sortOrder }));
}

export default function HostingTodoBoard() {
  const [rows, setRows] = useState<HostingTodoDto[]>([]);
  const [captains, setCaptains] = useState<CaptainApiDto[]>([]);
  const [currentGuardUids, setCurrentGuardUids] = useState<Set<string>>(new Set());
  const [expiredCaptainsInFuture, setExpiredCaptainsInFuture] = useState<Set<string>>(new Set());
  const [suppressedExpiredWarnings, setSuppressedExpiredWarnings] = useState<Set<string>>(new Set());
  /**
   * load 只读该集合、不应因它变化而重建：
   * 否则点「不再提示」会改变 load 的标识，进而触发 [load] 这个 effect 重新全量拉取，
   * 列表随之闪一下。用 ref 持有最新值，把它从 load 的依赖里摘掉。
   */
  const suppressedRef = useRef(suppressedExpiredWarnings);
  useEffect(() => {
    suppressedRef.current = suppressedExpiredWarnings;
  }, [suppressedExpiredWarnings]);
  const [showExpiredWarning, setShowExpiredWarning] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /**
   * 正在操作的条目 id。只让该条目变暗，而不是整列表跟着 busy 闪一下；
   * 改托管类型 / 勾卡任务这类单条操作，视觉上应只影响它自己。
   */
  const [busyItemId, setBusyItemId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [pendingWeek, setPendingWeek] = useState<PendingWeek | null>(null);
  const [captainFilter, setCaptainFilter] = useState('');
  const [leaveDates, setLeaveDates] = useState<string[]>([]);
  const [leaveDialogDate, setLeaveDialogDate] = useState<string | null>(null);
  /** 每周固休规则（1=周一 … 7=周日） */
  const [restDays, setRestDays] = useState<IsoWeekday[]>([]);
  const [restPanelOpen, setRestPanelOpen] = useState(false);
  /** 固休面板内的草稿，保存后才写回 restDays */
  const [restDraft, setRestDraft] = useState<IsoWeekday[]>([]);
  const [pendingRestDrop, setPendingRestDrop] = useState<PendingRestDrop | null>(null);
  const [restDropSuppress, setRestDropSuppress] = useState(false);
  const [queueMenu, setQueueMenu] = useState<QueueMenu | null>(null);
  const [deferPreview, setDeferPreview] = useState<DeferPreview | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(true);
  const [poolOpen, setPoolOpen] = useState(true);
  /** 当前展示周的周一（ISO 日期）；默认"今天所在周" */
  const [weekStart, setWeekStart] = useState<string>(() => mondayIsoOfWeekContaining(todayIsoDate()));
  /** 年视图弹窗：null 表示关闭，数字表示打开时使用的年份 */
  const [yearViewOpen, setYearViewOpen] = useState<number | null>(null);
  /** 当日「当日队列」正文收起：date 在 Set 内表示已收起 */
  const [collapsedDayQueues, setCollapsedDayQueues] = useState<Set<string>>(() => new Set());
  /** 舰长池九键分组收起：分组 key 在 Set 内表示已收起 */
  const [collapsedCaptainGroups, setCollapsedCaptainGroups] = useState<Set<number>>(() => new Set());
  const [pinyinReady, setPinyinReady] = useState<((text: string, options: { pattern: 'first'; toneType: 'none' }) => string) | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void preloadPinyinPro().then(fn => {
      if (active && fn) setPinyinReady(() => fn);
    });
    return () => {
      active = false;
    };
  }, []);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [todoRes, capR, guardRes] = await Promise.all([
        fetch('/api/admin/hosting-todos', { cache: 'no-store' }),
        fetchAdminCaptainsList(),
        fetch('/api/admin/captains/current-guard-list', { credentials: 'include' }).then(res => res.ok ? res.json() : null)
      ]);

      const todoBody = (await todoRes.json()) as {
        data?: HostingTodoDto[];
        leaveDates?: string[];
        restDays?: unknown;
        error?: string;
      };
      if (!todoRes.ok) {
        setError(todoBody.error || '任务板加载失败');
        setRows([]);
        setLeaveDates([]);
      } else {
        setRestDays(parseWeeklyRestDays(todoBody.restDays));
        const todos = Array.isArray(todoBody.data)
          ? todoBody.data.map(normalizeHostingTodo).filter((r): r is HostingTodoDto => r != null)
          : [];
        setRows(todos);
        setLeaveDates(
          Array.isArray(todoBody.leaveDates)
            ? todoBody.leaveDates.filter((d): d is string => typeof d === 'string' && d.length > 0)
            : [],
        );
      }

      if (!capR.ok) {
        if (todoRes.ok) setError(capR.error);
        setCaptains([]);
      } else {
        setCaptains(capR.data.map(normalizeCaptain).filter((c): c is CaptainApiDto => c != null));
      }

      // 更新当前榜单UID并检测未来排期中的非舰长
      if (guardRes?.data?.guardUids) {
        const uids = new Set(guardRes.data.guardUids as string[]);
        setCurrentGuardUids(uids);

        const today = todayIsoDate();
        const captainsMap = new Map<string, CaptainApiDto>();
        if (capR.ok) {
          capR.data.forEach((c: any) => {
            const captain = normalizeCaptain(c);
            if (captain) captainsMap.set(captainScheduleName(captain), captain);
          });
        }

        // 检测未来排期中的非舰长
        if (todoRes.ok && Array.isArray(todoBody.data)) {
          const expiredInFuture = new Set<string>();
          todoBody.data.forEach((todo: any) => {
            if (todo.todoDate > today) {
              const captain = captainsMap.get(todo.roleName);
              if (captain && !uids.has(captain.uid)) {
                expiredInFuture.add(todo.roleName);
              }
            }
          });
          setExpiredCaptainsInFuture(expiredInFuture);

          // 如果有非舰长且未被抑制，显示警告
          const unsuppressed = Array.from(expiredInFuture).filter(name => !suppressedRef.current.has(name));
          if (unsuppressed.length > 0) {
            setShowExpiredWarning(true);
          }
        }
      }
    } catch {
      setError('网络错误');
      setRows([]);
      setCaptains([]);
      setLeaveDates([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const submitLeave = useCallback(async (date: string, onLeave: boolean): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/hosting-leave', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todoDate: date, onLeave }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error || '请假状态保存失败');
        return false;
      }
      await load({ silent: true });
      setToast(onLeave ? `已标记 ${date} 请假，主页「搜打撤预案」该日红框展示。` : `已取消 ${date} 的请假。`);
      return true;
    } catch {
      setError('网络错误');
      return false;
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const clear = () => setHoverDate(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  useEffect(() => {
    if (leaveDialogDate === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setLeaveDialogDate(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaveDialogDate]);

  /** 右键菜单：Escape / 点击菜单外 / 滚动 均关闭 */
  useEffect(() => {
    if (!queueMenu) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setQueueMenu(null);
    }
    function onDown(e: MouseEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest('[data-queue-menu]')) return;
      setQueueMenu(null);
    }
    const close = () => setQueueMenu(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', close, true);
    };
  }, [queueMenu]);

  useEffect(() => {
    if (!restPanelOpen && !pendingRestDrop && !deferPreview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      setRestPanelOpen(false);
      setPendingRestDrop(null);
      setDeferPreview(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restPanelOpen, pendingRestDrop, deferPreview]);

  const byDate = useMemo(() => {
    const m = new Map<string, HostingTodoDto[]>();
    for (const r of rows) {
      const k = r.todoDate;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    }
    return m;
  }, [rows]);

  /** 跟随 weekStart 计算展示周（周一至周日） */
  const displayDates = useMemo(() => isoDatesCurrentWeek(weekStart), [weekStart]);
  const todayIso = todayIsoDate();
  const isCurrentWeek = displayDates.includes(todayIso);
  const weekRangeLabel = useMemo(() => {
    const first = displayDates[0];
    const last = displayDates[6];
    if (!first || !last) return '';
    const fp = parseIsoDateParts(first);
    const lp = parseIsoDateParts(last);
    if (fp.year === lp.year && fp.month === lp.month) {
      return `${fp.year}.${String(fp.month).padStart(2, '0')}.${String(fp.day).padStart(2, '0')} – ${String(lp.day).padStart(2, '0')}`;
    }
    if (fp.year === lp.year) {
      return `${fp.year}.${String(fp.month).padStart(2, '0')}.${String(fp.day).padStart(2, '0')} – ${String(lp.month).padStart(2, '0')}.${String(lp.day).padStart(2, '0')}`;
    }
    return `${first} – ${last}`;
  }, [displayDates]);

  const leaveSet = useMemo(() => new Set(leaveDates), [leaveDates]);
  const isRestDate = useCallback((iso: string) => isWeeklyRestDate(iso, restDays), [restDays]);
  const deferOptions = useMemo(() => ({ restDays, leaveDates: leaveSet }), [restDays, leaveSet]);

  const saveRestDays = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/hosting-rest-days', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restDays: restDraft }),
      });
      const body = (await res.json()) as { error?: string; data?: unknown };
      if (!res.ok) {
        setError(body.error || '固休保存失败');
        return;
      }
      setRestDays(parseWeeklyRestDays(body.data));
      setRestPanelOpen(false);
      setToast(restDraft.length ? `已设置每周固休：${formatRestDaysLabel(restDraft)}` : '已清除每周固休');
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }, [restDraft]);

  /** 执行延后：先本地算方案，有错直接报错，否则进预览确认 */
  const openDeferPreview = useCallback(
    (item: HostingTodoDto, mode: 'days' | 'occurrences', n: number) => {
      const plan =
        mode === 'days'
          ? planDeferByDays(toDeferRows(rows), item.id, n, deferOptions)
          : planDeferByOccurrences(toDeferRows(rows), item.id, n, deferOptions);
      setQueueMenu(null);
      if (plan.error) {
        setError(plan.error);
        return;
      }
      if (plan.moves.length === 0) {
        setToast('该方案下没有条目需要改期');
        return;
      }
      setDeferPreview({
        plan,
        anchorName: item.roleName,
        label: mode === 'days' ? `延后 ${n} 天` : `延后 ${n} 次`,
      });
    },
    [rows, deferOptions],
  );

  const commitDefer = useCallback(async () => {
    const preview = deferPreview;
    if (!preview) return;
    setDeferPreview(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/hosting-todos/bulk-move', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moves: preview.plan.moves.map(m => ({ id: m.id, toDate: m.toDate })) }),
      });
      const body = (await res.json()) as { error?: string; moved?: number };
      if (!res.ok) {
        setError(body.error || '延后失败');
        return;
      }
      setToast(`已${preview.label}，改期 ${body.moved ?? preview.plan.moves.length} 个条目`);
      await load({ silent: true });
    } catch {
      setError('网络错误');
    } finally {
      setBusy(false);
    }
  }, [deferPreview, load]);

  const filteredCaptains = useMemo(() => {
    const q = captainFilter.trim().toLowerCase();
    if (!q) return captains;
    return captains.filter(c => {
      const label = captainScheduleName(c).toLowerCase();
      const uid = (c.uid ?? '').toLowerCase();
      const rn = (c.remarkName ?? '').toLowerCase();
      const inn = (c.idName ?? '').toLowerCase();
      const note = (c.note ?? '').toLowerCase();
      const wx = (c.wechatRemark ?? '').toLowerCase();
      const gid = (c.gameIdRemark ?? '').toLowerCase();
      return (
        label.includes(q) ||
        uid.includes(q) ||
        rn.includes(q) ||
        inn.includes(q) ||
        note.includes(q) ||
        wx.includes(q) ||
        gid.includes(q) ||
        String(c.id).includes(q)
      );
    });
  }, [captains, captainFilter]);

  const captainsByT9 = useMemo(() => {
    try {
      const map = new Map<number, CaptainApiDto[]>();
      for (const k of T9_GROUP_KEYS) map.set(k, []);
      for (const c of filteredCaptains) {
        if (!c) continue;
        const label = captainScheduleName(c);
        const g = t9GroupKeyForDisplayName(label, pinyinReady);
        const bucket = map.get(g);
        if (bucket) bucket.push(c);
        else map.get(0)!.push(c);
      }
      for (const list of map.values()) {
        list.sort((a, b) => compareZhDisplayName(captainScheduleName(a), captainScheduleName(b)));
      }
      return map;
    } catch (e) {
      console.error('[HostingTodoBoard] captainsByT9', e);
      const fallback = new Map<number, CaptainApiDto[]>();
      for (const k of T9_GROUP_KEYS) fallback.set(k, []);
      fallback.set(0, [...filteredCaptains]);
      return fallback;
    }
  }, [filteredCaptains, pinyinReady]);

  async function persistReorder(todoDate: string, orderedIds: number[]) {
    const res = await fetch('/api/admin/hosting-todos/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ todoDate, orderedIds }),
    });
    const body = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(body.error || '排序失败');
  }

  async function executePost(body: { todoDate: string; roleName: string; hostType: string; stuckTask: boolean; captainId?: number; confirmWeekOverlap?: boolean }) {
    const res = await fetch('/api/admin/hosting-todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as ApiErrJson;
    if (!res.ok) {
      if (res.status === 409 && j.code === 'SAME_DAY_ROLE') {
        setError(j.error || '当日已有该角色/舰长安排，不可重复添加');
        return false;
      }
      if (res.status === 409 && j.code === 'WEEK_ROLE_OVERLAP') {
        setPendingWeek({
          kind: 'post',
          body: { todoDate: body.todoDate, roleName: body.roleName, hostType: body.hostType, stuckTask: body.stuckTask, captainId: body.captainId },
        });
        return false;
      }
      throw new Error(j.error || '添加失败');
    }
    return true;
  }

  async function executePut(id: number, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/hosting-todos/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = (await res.json()) as ApiErrJson;
    if (!res.ok) {
      if (res.status === 409 && j.code === 'SAME_DAY_ROLE') {
        setError(j.error || '当日已有该角色/舰长安排，不可重复添加');
        return false;
      }
      if (res.status === 409 && j.code === 'WEEK_ROLE_OVERLAP') {
        setPendingWeek({ kind: 'put', id, body: { ...body } });
        return false;
      }
      throw new Error(j.error || '操作失败');
    }
    return true;
  }

  /** 新建托管条目（右侧舰长拖入等）；冲突时 setError / setPendingWeek */
  async function submitNewHostingEntry(input: { todoDate: string; roleName: string; hostType: HostType; stuckTask: boolean; captainId?: number }) {
    const role = input.roleName.trim();
    if (!role) {
      setError('角色名不能为空');
      return;
    }
    const payload = { todoDate: input.todoDate, roleName: role, hostType: input.hostType, stuckTask: input.stuckTask, captainId: input.captainId };
    const c = analyzeRoleScheduleConflict(toSchedulingRows(rows), {
      targetDate: input.todoDate,
      roleName: role,
      excludeId: undefined,
    });
    if (c.sameDayBlocked) {
      setError('当日已有该角色/舰长安排，不可重复添加');
      return;
    }
    if (c.weekNeedsAck) {
      setPendingWeek({ kind: 'post', body: payload });
      return;
    }
    const ok = await executePost({ ...payload, confirmWeekOverlap: false });
    if (!ok) return;
    await load({ silent: true });
  }

  async function patchItem(id: number, patch: Partial<{ hostType: string; stuckTask: boolean; roleName: string }>) {
    // 单条编辑：只标记该条目，不动全局 busy，避免整列表变暗
    setBusyItemId(id);
    setError(null);
    try {
      if (patch.roleName !== undefined) {
        const item = rows.find(r => r.id === id);
        if (!item) {
          setError('条目不存在');
          return;
        }
        const nextRole = patch.roleName.trim();
        if (!nextRole) {
          setError('角色名不能为空');
          return;
        }
        const c = analyzeRoleScheduleConflict(toSchedulingRows(rows), {
          targetDate: item.todoDate,
          roleName: nextRole,
          excludeId: id,
        });
        if (c.sameDayBlocked) {
          setError('当日已有该角色/舰长安排，不可重复添加');
          return;
        }
        if (c.weekNeedsAck) {
          setPendingWeek({ kind: 'put', id, body: { ...patch } });
          return;
        }
      }

      const ok = await executePut(id, patch);
      if (!ok) return;
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setBusyItemId(null);
    }
  }

  async function removeItem(id: number) {
    if (!window.confirm('从任务板移除此条目？')) return;
    setBusyItemId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/hosting-todos/${id}`, { method: 'DELETE' });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || '删除失败');
      setToast('已移除');
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    } finally {
      setBusyItemId(null);
    }
  }

  /** @param skipRestCheck 固休确认弹窗已放行时为 true，避免再次拦截 */
  async function moveToDate(id: number, newDate: string, skipRestCheck = false) {
    const item = rows.find(r => r.id === id);
    if (!item) {
      setError('条目不存在');
      return;
    }
    if (item.todoDate === newDate) return;

    // 落到固休日的后果与新建一致，同样拦截确认
    if (!skipRestCheck && isRestDate(newDate) && !readRestDropSuppressed(todayIsoDate())) {
      setRestDropSuppress(false);
      setPendingRestDrop({ kind: 'move', targetDate: newDate, id, roleName: item.roleName });
      return;
    }

    const c = analyzeRoleScheduleConflict(toSchedulingRows(rows), {
      targetDate: newDate,
      roleName: item.roleName,
      excludeId: id,
    });
    if (c.sameDayBlocked) {
      setError('当日已有该角色/舰长安排，不可重复添加');
      return;
    }
    if (c.weekNeedsAck) {
      setPendingWeek({ kind: 'put', id, body: { todoDate: newDate } });
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const ok = await executePut(id, { todoDate: newDate });
      if (!ok) return;
      setToast('已调度至目标日期');
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '移动失败');
    } finally {
      setBusy(false);
    }
  }

  /** 固休确认弹窗「仍要排入」 */
  async function confirmRestDropAction() {
    const p = pendingRestDrop;
    if (!p) return;
    setPendingRestDrop(null);
    if (restDropSuppress) writeRestDropSuppressed(todayIsoDate());

    setError(null);
    try {
      if (p.kind === 'create') {
        // submitNewHostingEntry 自己不管 busy（平时由 onDropCaptainOnDate 包着），这里补上
        setBusy(true);
        try {
          await submitNewHostingEntry({
            todoDate: p.targetDate,
            roleName: p.roleName,
            hostType: DRAG_IN_HOST_TYPE,
            stuckTask: DRAG_IN_STUCK,
            captainId: p.captainId,
          });
        } finally {
          setBusy(false);
        }
      } else {
        // moveToDate 自带 setBusy/finally，外面再包一层会被它的 finally 提前清掉
        await moveToDate(p.id, p.targetDate, true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    }
  }

  async function confirmWeekOverlapAction() {
    if (!pendingWeek) return;
    const p = pendingWeek;
    setPendingWeek(null);
    setBusy(true);
    setError(null);
    try {
      if (p.kind === 'post') {
        const ok = await executePost({ ...p.body, confirmWeekOverlap: true });
        if (!ok) return;
      } else {
        const ok = await executePut(p.id, { ...p.body, confirmWeekOverlap: true });
        if (!ok) return;
      }
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  }

  function onDragStartHosting(e: React.DragEvent, item: HostingTodoDto) {
    e.dataTransfer.setData(MIME_HOSTING, JSON.stringify({ id: item.id, fromDate: item.todoDate }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragStartCaptain(e: React.DragEvent, c: CaptainApiDto) {
    const roleName = captainScheduleName(c);
    e.dataTransfer.setData(MIME_CAPTAIN, JSON.stringify({ roleName, captainId: c.id }));
    e.dataTransfer.setData('text/plain', roleName);
    e.dataTransfer.effectAllowed = 'copy';
  }

  function pickDropEffect(e: React.DragEvent): 'copy' | 'move' {
    const types = dataTransferTypeList(e.dataTransfer);
    if (types.includes(MIME_CAPTAIN)) return 'copy';
    return 'move';
  }

  async function onDropCaptainOnDate(targetDate: string, capRaw: string) {
    let roleName = '';
    let captainId: number | undefined;
    try {
      const parsed = JSON.parse(capRaw) as { roleName?: string; captainId?: number };
      roleName = parsed.roleName ?? '';
      captainId = typeof parsed.captainId === 'number' ? parsed.captainId : undefined;
    } catch {
      return;
    }
    // 固休日先确认，通过后才可能继续走「一周内重复」确认
    if (isRestDate(targetDate) && !readRestDropSuppressed(todayIsoDate())) {
      setRestDropSuppress(false);
      setPendingRestDrop({ kind: 'create', targetDate, roleName, captainId });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitNewHostingEntry({
        todoDate: targetDate,
        roleName,
        hostType: DRAG_IN_HOST_TYPE,
        stuckTask: DRAG_IN_STUCK,
        captainId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setBusy(false);
    }
  }

  async function onDropOnDayZone(e: React.DragEvent, targetDate: string) {
    e.preventDefault();
    setHoverDate(null);
    setCollapsedDayQueues(prev => {
      if (!prev.has(targetDate)) return prev;
      const n = new Set(prev);
      n.delete(targetDate);
      return n;
    });
    const capRaw = e.dataTransfer.getData(MIME_CAPTAIN);
    if (capRaw) {
      await onDropCaptainOnDate(targetDate, capRaw);
      return;
    }
    const raw = e.dataTransfer.getData(MIME_HOSTING);
    if (!raw) return;
    let parsed: { id: number; fromDate: string };
    try {
      parsed = JSON.parse(raw) as { id: number; fromDate: string };
    } catch {
      return;
    }
    if (parsed.fromDate === targetDate) return;
    await moveToDate(parsed.id, targetDate);
  }

  async function onDropOnCard(e: React.DragEvent, date: string, target: HostingTodoDto, dragId: number) {
    e.preventDefault();
    e.stopPropagation();
    setHoverDate(null);
    const capRaw = e.dataTransfer.getData(MIME_CAPTAIN);
    if (capRaw) {
      await onDropCaptainOnDate(date, capRaw);
      return;
    }
    if (dragId === target.id) return;
    const list = byDate.get(date) ?? [];
    const ids = list.map(x => x.id);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const place = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    const next = reorderIds(ids, dragId, target.id, place);
    try {
      setBusy(true);
      await persistReorder(date, next);
      await load({ silent: true });
      setToast('顺序已更新');
    } catch (err) {
      setError(err instanceof Error ? err.message : '排序失败');
    } finally {
      setBusy(false);
    }
  }

  function onDragOverZone(e: React.DragEvent, date: string) {
    e.preventDefault();
    e.dataTransfer.dropEffect = pickDropEffect(e);
    setHoverDate(date);
  }

  function renderMissionCard(item: HostingTodoDto, date: string) {
    const ht = isHostType(item.hostType) ? item.hostType : DEFAULT_HOST_TYPE;
    // 检查是否是非舰长
    const captain = captains.find(c => captainScheduleName(c) === item.roleName);
    const isExpired = captain && currentGuardUids.size > 0 && !currentGuardUids.has(captain.uid);
    // 只有本条目在操作、或整板级操作（拖动/延后）时才禁用
    const itemBusy = busyItemId === item.id || busy;

    return (
      <li
        key={item.id}
        draggable
        onDragStart={e => onDragStartHosting(e, item)}
        onContextMenu={e => {
          e.preventDefault();
          e.stopPropagation();
          setQueueMenu({ item, x: e.clientX, y: e.clientY });
        }}
        onDragOver={e => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = pickDropEffect(e);
        }}
        onDrop={e => {
          e.preventDefault();
          e.stopPropagation();
          const capRaw = e.dataTransfer.getData(MIME_CAPTAIN);
          if (capRaw) {
            void onDropCaptainOnDate(date, capRaw);
            return;
          }
          const raw = e.dataTransfer.getData(MIME_HOSTING);
          if (!raw) return;
          try {
            const { id: dragId, fromDate } = JSON.parse(raw) as { id: number; fromDate: string };
            if (fromDate !== date) {
              void moveToDate(dragId, date);
              return;
            }
            void onDropOnCard(e, date, item, dragId);
          } catch {
            /* ignore */
          }
        }}
        className={`${th.card} ${th.cardAccent} rounded-r-md px-3.5 py-3 pl-3.5 sm:px-4 ${itemBusy ? 'opacity-50' : ''}`}>
        <div className="flex flex-col gap-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <p className={`font-mono text-base font-semibold leading-snug tracking-tight sm:text-lg ${isExpired ? 'text-red-400' : 'text-[#ece8df]'}`}>
                {item.roleName}
              </p>
              {isExpired && (
                <span
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold cursor-help"
                  title="该舰长已过期"
                >
                  !
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {item.stuckTask ? (
                <span
                  className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded border border-amber-700/60 bg-amber-950/80 px-2 font-mono text-base font-bold text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.25)]"
                  title="卡任务">
                  !
                </span>
              ) : null}
              <button
                type="button"
                className="whitespace-nowrap text-sm text-[#b87a7a] transition hover:text-[#e8a0a0]"
                onClick={() => void removeItem(item.id)}
                disabled={itemBusy}>
                移除
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <select
              className="max-w-[140px] cursor-pointer rounded border border-[#2a3344] bg-[#0a0d12] px-2.5 py-1.5 text-sm text-[#b8c0cc] outline-none focus:border-[#c8aa6e]/50"
              value={ht}
              onChange={e => void patchItem(item.id, { hostType: e.target.value })}
              disabled={itemBusy}>
              {HOST_TYPES.map(t => (
                <option key={t} value={t}>
                  {HOST_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-[#9aa5b4]">
              <input
                type="checkbox"
                className="accent-[#c8aa6e]"
                checked={item.stuckTask}
                onChange={e => void patchItem(item.id, { stuckTask: e.target.checked })}
                disabled={itemBusy}
              />
              卡任务
            </label>
          </div>
        </div>
      </li>
    );
  }

  return (
    <div className={`relative flex h-full min-h-0 flex-1 flex-col overflow-hidden ${th.page}`}>
      {/* 过期舰长警告弹窗 */}
      {showExpiredWarning && expiredCaptainsInFuture.size > 0 && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={() => setShowExpiredWarning(false)} />
          <div className={`fixed left-1/2 top-1/2 z-50 w-[min(90vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border ${th.line} ${th.panel} p-6 shadow-2xl`}>
            <h2 className={`text-center text-lg font-bold ${th.gold}`}>⚠️ 未来排期提醒</h2>
            <p className={`mt-3 text-sm leading-relaxed ${th.muted}`}>
              以下非舰长仍在未来排期计划中：
            </p>
            <ul className="mt-3 max-h-48 overflow-y-auto space-y-2">
              {Array.from(expiredCaptainsInFuture).filter(name => !suppressedExpiredWarnings.has(name)).map(name => (
                <li key={name} className="flex items-center justify-between gap-3 rounded bg-red-950/20 px-3 py-2">
                  <span className="text-sm text-red-300">{name}</span>
                  <button
                    type="button"
                    className="text-xs text-[#9499a0] hover:text-[#d4cfc4]"
                    onClick={() => {
                      setSuppressedExpiredWarnings(prev => new Set([...prev, name]));
                      const remaining = Array.from(expiredCaptainsInFuture).filter(n => n !== name && !suppressedExpiredWarnings.has(n));
                      if (remaining.length === 0) {
                        setShowExpiredWarning(false);
                      }
                    }}
                  >
                    不再提示
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                className={`min-w-[120px] ${th.btn}`}
                onClick={() => setShowExpiredWarning(false)}
              >
                知道了
              </button>
            </div>
          </div>
        </>
      )}

      {leaveDialogDate !== null ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[100] cursor-default bg-black/55 backdrop-blur-[1px]"
            aria-label="关闭请假确认"
            onClick={() => setLeaveDialogDate(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hosting-leave-dialog-title"
            className={`fixed left-1/2 top-[42%] z-[101] w-[min(92vw,380px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-2xl ${th.panel}`}>
            <h2 id="hosting-leave-dialog-title" className={`text-center text-base font-semibold ${th.gold}`}>
              真的要请假吗？
            </h2>
            <p className={`mt-2 text-center font-mono text-xs ${th.muted}`}>
              {leaveDialogDate} · {weekdayLabel(leaveDialogDate)}
            </p>
            <p className={`mt-3 text-center text-sm leading-relaxed ${th.muted}`}>确认是否抛弃该日老板们？</p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row-reverse sm:justify-center sm:gap-3">
              <button
                type="button"
                disabled={busy}
                className="w-full rounded border border-rose-900/55 bg-rose-950/35 px-4 py-2.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-950/55 disabled:opacity-40 sm:w-auto sm:min-w-[120px]"
                onClick={async () => {
                  const d = leaveDialogDate;
                  if (!d) return;
                  const ok = await submitLeave(d, true);
                  if (ok) setLeaveDialogDate(null);
                }}>
                确认抛弃
              </button>
              <button
                type="button"
                className={`w-full sm:w-auto sm:min-w-[120px] ${th.btn}`}
                onClick={() => setLeaveDialogDate(null)}>
                我要上班
              </button>
            </div>
          </div>
        </>
      ) : null}

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-4 sm:px-6">
        {/*
          浮层而非占位：之前这两条是文档流里的 shrink-0 块，出现/消失会改变列表高度，
          列表被顶下去再弹回来，看着就是「闪一下」。改成 fixed 后不参与布局。
        */}
        {toast || error ? (
          <div className="pointer-events-none fixed left-1/2 top-3 z-[220] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2">
            {toast ? <p className={`rounded px-3 py-2 text-sm shadow-lg ${th.toastOk}`}>{toast}</p> : null}
            {/* 错误不自动消失，所以要能点掉（toast 2.8s 后自己走） */}
            {error ? (
              <div className={`pointer-events-auto flex items-start gap-2 rounded px-3 py-2 text-sm shadow-lg ${th.toastErr}`}>
                <span className="min-w-0 flex-1">{error}</span>
                <button
                  type="button"
                  className="shrink-0 px-1 leading-none opacity-70 transition hover:opacity-100"
                  aria-label="关闭错误提示"
                  onClick={() => setError(null)}>
                  ✕
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className={`py-16 text-center font-mono text-sm ${th.muted}`}>同步任务数据…</p>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:flex-row lg:gap-0">
            {/* 任务列表：本周排期 + 当日队列 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden lg:pr-4">
              <div
                className={`mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-[#c8aa6e]/25 px-3 py-2 ${th.panel}`}>
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-left transition hover:opacity-90"
                  onClick={() => setScheduleOpen(o => !o)}
                  aria-expanded={scheduleOpen}>
                  <CollapseChevron open={scheduleOpen} />
                  <span className={`truncate font-mono text-xs font-semibold uppercase tracking-[0.14em] ${th.gold}`}>
                    任务列表 · 排期
                  </span>
                </button>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className={`${th.btnGhost} px-2 py-1 text-[11px]`}
                    onClick={() => setWeekStart(prev => addDaysIso(prev, -7))}
                    title="上一周">
                    〈 上周
                  </button>
                  <button
                    type="button"
                    className={`${th.btnGhost} px-2 py-1 text-[11px] ${isCurrentWeek ? 'opacity-50' : ''}`}
                    disabled={isCurrentWeek}
                    onClick={() => setWeekStart(mondayIsoOfWeekContaining(todayIsoDate()))}
                    title="回到今天所在周">
                    今天
                  </button>
                  <button
                    type="button"
                    className={`${th.btnGhost} px-2 py-1 text-[11px]`}
                    onClick={() => setWeekStart(prev => addDaysIso(prev, 7))}
                    title="下一周">
                    下周 〉
                  </button>
                  <span className={`mx-1 hidden font-mono text-[11px] sm:inline ${th.muted}`}>{weekRangeLabel}</span>
                  <button
                    type="button"
                    className={`${th.btnGhost} px-2 py-1 text-[11px]`}
                    onClick={() => {
                      setRestDraft(restDays);
                      setRestPanelOpen(true);
                    }}
                    title={`每周固休：${formatRestDaysLabel(restDays)}`}>
                    固休{restDays.length ? ` · ${restDays.length}` : ''}
                  </button>
                  <button
                    type="button"
                    className={`${th.btn} px-2.5 py-1 text-[11px]`}
                    onClick={() => setYearViewOpen(parseIsoDateParts(weekStart).year)}
                    title="按月/年浏览">
                    年视图
                  </button>
                </div>
              </div>
              {scheduleOpen ? (
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0">
                  <div className="w-full max-w-5xl xl:max-w-6xl">
                    <p className={`mb-3 font-mono text-xs uppercase tracking-[0.12em] ${th.muted}`}>
                      <span className="sm:hidden">{weekRangeLabel} · </span>
                      {isCurrentWeek ? '本周排期' : '所选周排期'}（周一至周日）· 红框为本周最后一天 · 左侧每日下方可标记请假 ·
                      灰底「固休」为每周固休 · 右键条目可按天/按次延后
                    </p>
                    {displayDates.map((date: string, idx: number) => {
                      const list = byDate.get(date) ?? [];
                      const { dayNum, ym, wd } = parseMissionDate(date);
                      const isHover = hoverDate === date;
                      const isWeekLastDay = idx === displayDates.length - 1;
                      return (
                        <section
                          key={date}
                          title={isWeekLastDay ? '本周最后一天（周日）' : undefined}
                          className={`relative flex min-h-[1px] rounded-md ${isWeekLastDay ? 'ring-2 ring-inset ring-[#b91c1c]/85' : ''}`}>
                          {idx < displayDates.length - 1 ? (
                            <div
                              className="pointer-events-none absolute bottom-0 left-[100px] top-[7.25rem] w-px bg-gradient-to-b from-[#c8aa6e]/35 via-[#2a3344] to-transparent sm:left-[120px] sm:top-[7.75rem]"
                              aria-hidden
                            />
                          ) : null}

                          <div
                            title={
                              leaveSet.has(date) && isRestDate(date)
                                ? '固休 + 已请假'
                                : isRestDate(date)
                                  ? '每周固休'
                                  : undefined
                            }
                            className={`relative flex w-[100px] shrink-0 flex-col items-end border-r ${th.line} ${th.rail} py-5 pr-3 sm:w-[120px] sm:pr-4 ${
                              leaveSet.has(date)
                                ? 'bg-rose-950/20 ring-1 ring-inset ring-rose-900/35'
                                : isRestDate(date)
                                  ? 'bg-[#141821] ring-1 ring-inset ring-[#39414f]'
                                  : ''
                            }`}>
                            <span className="font-mono text-4xl font-bold leading-none tracking-tight text-[#c8aa6e] sm:text-5xl">{dayNum}</span>
                            <span className="mt-1.5 font-mono text-xs tracking-widest text-[#5c6574]">{ym}</span>
                            <span className="mt-1 text-sm text-[#8a9199]">{wd}</span>
                            {/* 请假（红）优先级高于固休（灰）；同日时只显示红色，差异在 title 里说明 */}
                            {isRestDate(date) && !leaveSet.has(date) ? (
                              <span className="mt-1.5 rounded border border-[#3d4654] bg-[#1b2029] px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-[#9aa5b4]">
                                固休
                              </span>
                            ) : null}
                            <div className="mt-3 flex w-full flex-col items-end gap-1.5">
                              {leaveSet.has(date) ? (
                                <>
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-rose-400/95">已请假</span>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void submitLeave(date, false)}
                                    className={`${th.btnGhost} max-w-full whitespace-normal px-2 py-1 text-center text-[10px] leading-tight sm:text-[11px]`}>
                                    取消请假
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setLeaveDialogDate(date)}
                                  className={`${th.btnGhost} border-amber-900/40 px-2 py-1 text-[10px] font-semibold text-amber-200/90 hover:border-amber-700/50 sm:text-[11px]`}>
                                  请假
                                </button>
                              )}
                            </div>
                          </div>

                          <div
                            className={`min-h-[104px] flex-1 border-b ${th.line} py-4 pl-3 pr-2 transition sm:pl-5 sm:pr-3 ${
                              isHover ? 'bg-[rgba(200,170,110,0.07)] ring-1 ring-inset ring-[#c8aa6e]/35' : 'bg-[#0a0c10]/50'
                            }`}
                            onDragOver={e => onDragOverZone(e, date)}
                            onDragLeave={e => {
                              if (!e.currentTarget.contains(e.relatedTarget as Node)) setHoverDate(null);
                            }}
                            onDrop={e => void onDropOnDayZone(e, date)}>
                            <div className="mb-2 flex items-center justify-between gap-2 pr-1">
                              <button
                                type="button"
                                className="group flex min-w-0 items-center gap-1.5 rounded border border-transparent px-1 py-0.5 text-left transition hover:border-[#c8aa6e]/35 hover:bg-[#c8aa6e]/8"
                                onClick={e => {
                                  e.stopPropagation();
                                  setCollapsedDayQueues(prev => {
                                    const n = new Set(prev);
                                    if (n.has(date)) n.delete(date);
                                    else n.add(date);
                                    return n;
                                  });
                                }}
                                aria-expanded={!collapsedDayQueues.has(date)}
                                title={collapsedDayQueues.has(date) ? '展开当日队列' : '收起当日队列'}>
                                <CollapseChevron open={!collapsedDayQueues.has(date)} size="sm" className="text-[#c8aa6e]" />
                                <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-[#c8aa6e] group-hover:text-[#dfc48a]">
                                  当日队列
                                </span>
                              </button>
                              <span className={`shrink-0 text-xs ${th.muted}`}>{list.length} 项</span>
                            </div>

                            {!collapsedDayQueues.has(date) ? (
                              list.length === 0 ? (
                                <div
                                  className={`flex min-h-[76px] items-center justify-center rounded-md border border-dashed px-3 py-6 text-center font-mono text-sm leading-relaxed transition ${
                                    isHover ? 'border-[#c8aa6e]/50 bg-[rgba(200,170,110,0.05)] text-[#d4c4a0]' : 'border-[#2a3344] text-[#6d7684]'
                                  }`}>
                                  从右侧「舰长池」拖入此处；或拖至本周其他日
                                </div>
                              ) : (
                                <ul className="flex flex-col gap-2.5 pr-1">{list.map(item => renderMissionCard(item, date))}</ul>
                              )
                            ) : (
                              <div
                                className={`flex min-h-[76px] items-center justify-center rounded-md border border-dashed px-3 py-5 text-center text-xs leading-relaxed transition ${
                                  isHover ? 'border-[#c8aa6e]/50 bg-[rgba(200,170,110,0.05)] text-[#b8a880]' : 'border-[#2a3344] text-[#6d7684]'
                                }`}>
                                已收起 · 仍可拖入舰长 · 点击「当日队列」展开查看
                              </div>
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            {/* 舰长池（拖出为 copy，不减少列表） */}
            <aside
              className={`flex shrink-0 flex-col overflow-hidden border-t ${th.line} bg-[#0a0c10] transition-[width,max-height] duration-200 ease-out lg:min-h-0 lg:border-l lg:border-t-0 lg:bg-[#0c0f14] ${
                poolOpen
                  ? 'max-h-[min(44vh,400px)] min-h-0 w-full lg:max-h-none lg:w-80 xl:w-96'
                  : 'max-h-[3.5rem] min-h-0 w-full lg:max-h-none lg:w-11'
              }`}>
              <div className={`flex shrink-0 items-center gap-2 border-b ${th.line} px-2 py-2 sm:px-3`}>
                <button
                  type="button"
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left ${!poolOpen ? 'lg:flex-col lg:justify-center lg:gap-1.5 lg:py-3' : ''}`}
                  onClick={() => setPoolOpen(o => !o)}
                  aria-expanded={poolOpen}
                  title={poolOpen ? '收起舰长池' : '展开舰长池'}>
                  <CollapseChevron open={poolOpen} className="shrink-0" />
                  {poolOpen ? (
                    <span className="truncate font-mono text-sm font-semibold uppercase tracking-[0.12em] text-[#c8aa6e]">舰长池</span>
                  ) : (
                    <>
                      <span className="truncate font-mono text-sm font-semibold uppercase tracking-[0.12em] text-[#c8aa6e] lg:hidden">舰长池</span>
                      <span className="hidden select-none font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#c8aa6e] lg:block lg:[writing-mode:vertical-rl]">
                        舰长池
                      </span>
                    </>
                  )}
                </button>
                {poolOpen ? (
                  <button
                    type="button"
                    onClick={() => void load({ silent: true })}
                    disabled={loading || busy}
                    className={`${th.btnGhost} shrink-0 whitespace-nowrap px-2 py-1 text-[11px]`}>
                    刷新
                  </button>
                ) : null}
              </div>
              {poolOpen ? (
                <>
                  <div className={`shrink-0 border-b ${th.line} px-3 py-2`}>
                    <label className={`mb-1 block font-mono text-[10px] uppercase tracking-wider ${th.muted}`}>关键字筛选</label>
                    <input
                      type="search"
                      className={`${th.input} w-full text-sm`}
                      value={captainFilter}
                      onChange={e => setCaptainFilter(e.target.value)}
                      placeholder="姓名、UID、备注…"
                      disabled={busy}
                      autoComplete="off"
                    />
                  </div>
                  <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
                    {captains.length === 0 ? (
                      <p className={`px-1 py-6 text-center text-xs leading-relaxed ${th.muted}`}>
                        暂无舰长档案。请先在「舰长管理」中添加后再从此处拖入。
                      </p>
                    ) : filteredCaptains.length === 0 ? (
                      <p className={`px-1 py-6 text-center text-sm leading-relaxed ${th.muted}`}>无匹配舰长，请调整筛选关键字。</p>
                    ) : (
                      <div className="flex flex-col">
                        {T9_GROUP_KEYS.map(key => {
                          const groupList = captainsByT9.get(key) ?? [];
                          if (groupList.length === 0) return null;
                          return (
                            <div key={key} className="mb-5 last:mb-0">
                              <div
                                className={`sticky top-0 z-[1] -mx-1 mb-2 flex items-center justify-between gap-2 border-b ${th.line} bg-[#0c0f14] px-1 py-2`}>
                                <span className="min-w-0 truncate font-mono text-xs font-semibold tracking-wide text-[#c8aa6e]">
                                  {T9_GROUP_LABEL[key]}
                                </span>
                                <button
                                  type="button"
                                  className="flex shrink-0 items-center gap-1 rounded border border-[#2a3344] bg-[#12161f] px-1.5 py-1 text-[10px] font-medium text-[#c8aa6e] transition hover:border-[#c8aa6e]/40 hover:bg-[#c8aa6e]/10"
                                  onClick={() =>
                                    setCollapsedCaptainGroups(prev => {
                                      const n = new Set(prev);
                                      if (n.has(key)) n.delete(key);
                                      else n.add(key);
                                      return n;
                                    })
                                  }
                                  aria-expanded={!collapsedCaptainGroups.has(key)}
                                  title={collapsedCaptainGroups.has(key) ? '展开分组' : '收起分组'}>
                                  <CollapseChevron open={!collapsedCaptainGroups.has(key)} size="sm" />
                                  <span className="hidden sm:inline">{collapsedCaptainGroups.has(key) ? '展开' : '收起'}</span>
                                </button>
                              </div>
                              {!collapsedCaptainGroups.has(key) ? (
                              <ul className="flex flex-col gap-2">
                                {groupList.map(c => {
                                  const scheduleLabel = captainScheduleName(c);
                                  const poolLine = captainPoolDisplayLine(c);
                                  return (
                                    <li key={c.id}>
                                      <div
                                        draggable
                                        onDragStart={e => onDragStartCaptain(e, c)}
                                        className={`flex cursor-grab items-center gap-3 rounded-md border ${th.line} bg-gradient-to-r from-[#12161f] to-[#0e1118] px-3 py-2.5 transition active:cursor-grabbing hover:border-[#c8aa6e]/30 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
                                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[#2a3344] bg-[#0a0d12]">
                                          {c.avatarUrl ? (
                                            <img
                                              src={captainAvatarImgSrc(c.avatarUrl, c.updatedAt ?? 0)}
                                              alt=""
                                              referrerPolicy={captainAvatarImgReferrerPolicy(c.avatarUrl)}
                                              className="h-full w-full object-cover"
                                            />
                                          ) : (
                                            <div className="flex h-full w-full items-center justify-center font-mono text-xs text-[#6d7684]">
                                              {scheduleLabel.slice(0, 2)}
                                            </div>
                                          )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                          <p className="truncate font-mono text-base font-medium text-[#ece8df]">{poolLine}</p>
                                          {c.shipTierLabel ? (
                                            <p className={`mt-0.5 truncate text-xs ${th.muted}`}>{c.shipTierLabel}</p>
                                          ) : null}
                                        </div>
                                      </div>
                                    </li>
                                  );
                                })}
                              </ul>
                              ) : (
                                <p></p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </aside>
          </div>
        )}
      </main>

      {/* 每周固休配置 */}
      {restPanelOpen ? (
        <>
          <button
            type="button"
            aria-label="关闭固休设置"
            className="fixed inset-0 z-[100] cursor-default bg-black/55 backdrop-blur-[1px]"
            onClick={() => setRestPanelOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hosting-rest-dialog-title"
            className={`fixed left-1/2 top-[42%] z-[101] w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-2xl ${th.panel}`}>
            <h2 id="hosting-rest-dialog-title" className={`text-center text-base font-semibold ${th.gold}`}>
              每周固休
            </h2>
            <p className={`mt-2 text-center text-xs leading-relaxed ${th.muted}`}>
              可多选。固休日仍可拖入，但会先弹窗确认；延后时会跳过空的固休日与请假日，
              <span className="text-[#b8a880]">已有安排的固休日按正常排期日对待</span>。
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {WEEKDAY_OPTIONS.map(opt => {
                const checked = restDraft.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-2 text-sm transition ${
                      checked
                        ? `${th.goldBorder} ${th.goldBg} text-[#e8d49a]`
                        : 'border-[#2a3344] text-[#9aa5b4] hover:border-[#3d4a5f]'
                    }`}>
                    <input
                      type="checkbox"
                      className="accent-[#c8aa6e]"
                      checked={checked}
                      disabled={busy}
                      onChange={e =>
                        setRestDraft(prev =>
                          e.target.checked
                            ? [...prev, opt.value].sort((a, b) => a - b)
                            : prev.filter(v => v !== opt.value),
                        )
                      }
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
            <p className={`mt-3 text-center font-mono text-[11px] ${th.muted}`}>
              当前草稿：{formatRestDaysLabel(restDraft)}
            </p>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row-reverse sm:justify-center sm:gap-3">
              <button
                type="button"
                disabled={busy || restDraft.length === 7}
                className={`w-full sm:w-auto sm:min-w-[120px] ${th.btn}`}
                onClick={() => void saveRestDays()}>
                保存
              </button>
              <button
                type="button"
                disabled={busy}
                className={`w-full sm:w-auto sm:min-w-[120px] ${th.btnGhost}`}
                onClick={() => setRestPanelOpen(false)}>
                取消
              </button>
            </div>
            {restDraft.length === 7 ? (
              <p className="mt-2 text-center text-[11px] text-rose-300">不能把 7 天全部设为固休。</p>
            ) : null}
          </div>
        </>
      ) : null}

      {/* 拖入固休日确认 */}
      {pendingRestDrop ? (
        <>
          <button
            type="button"
            aria-label="取消排入固休日"
            className="fixed inset-0 z-[100] cursor-default bg-black/55 backdrop-blur-[1px]"
            onClick={() => setPendingRestDrop(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="hosting-rest-drop-title"
            className={`fixed left-1/2 top-[42%] z-[101] w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-lg border p-5 shadow-2xl ${th.panel}`}>
            <h2 id="hosting-rest-drop-title" className={`text-center text-base font-semibold ${th.gold}`}>
              该日为每周固休
            </h2>
            <p className={`mt-2 text-center font-mono text-xs ${th.muted}`}>
              {pendingRestDrop.targetDate} · {weekdayLabel(pendingRestDrop.targetDate)}
            </p>
            <p className={`mt-3 text-center text-sm leading-relaxed ${th.muted}`}>
              确认把「{pendingRestDrop.roleName}」{pendingRestDrop.kind === 'create' ? '排入' : '改期到'}固休日？
            </p>
            <label className={`mt-4 flex cursor-pointer items-center justify-center gap-2 text-xs ${th.muted}`}>
              <input
                type="checkbox"
                className="accent-[#c8aa6e]"
                checked={restDropSuppress}
                onChange={e => setRestDropSuppress(e.target.checked)}
              />
              今日不再提醒
            </label>
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row-reverse sm:justify-center sm:gap-3">
              <button
                type="button"
                disabled={busy}
                className={`w-full sm:w-auto sm:min-w-[120px] ${th.btn}`}
                onClick={() => void confirmRestDropAction()}>
                仍要排入
              </button>
              <button
                type="button"
                disabled={busy}
                className={`w-full sm:w-auto sm:min-w-[120px] ${th.btnGhost}`}
                onClick={() => setPendingRestDrop(null)}>
                取消
              </button>
            </div>
          </div>
        </>
      ) : null}

      {queueMenu ? <QueueContextMenu menu={queueMenu} busy={busy} onDefer={openDeferPreview} /> : null}

      {/* 延后预览确认 */}
      {deferPreview ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
          <div className={`w-[min(92vw,440px)] rounded-lg border ${th.line} ${th.panel} p-6 shadow-2xl`}>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#c8aa6e]">延后确认</p>
            <h2 className="mt-2 text-lg font-semibold text-[#ece8df]">
              以「{deferPreview.anchorName}」为起点，{deferPreview.label}
            </h2>
            <dl className={`mt-4 space-y-2 text-sm ${th.muted}`}>
              <div className="flex justify-between gap-3">
                <dt>受影响条目</dt>
                <dd className="font-mono text-[#d4cfc4]">{deferPreview.plan.affectedCount} 个</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>实际改期</dt>
                <dd className="font-mono text-[#d4cfc4]">{deferPreview.plan.moves.length} 个</dd>
              </div>
              {deferPreview.plan.originalRange && deferPreview.plan.nextRange ? (
                <div className="flex justify-between gap-3">
                  <dt>日期范围</dt>
                  <dd className="text-right font-mono text-[11px] text-[#d4cfc4]">
                    {deferPreview.plan.nextRange.from} → {deferPreview.plan.nextRange.to}
                    <span className="block text-[#6d7684]">
                      原 {deferPreview.plan.originalRange.from} → {deferPreview.plan.originalRange.to}
                    </span>
                  </dd>
                </div>
              ) : null}
            </dl>
            {deferPreview.plan.crowdedDays > 0 ? (
              <p className="mt-3 rounded border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-[11px] leading-relaxed text-amber-200/90">
                延后后有 {deferPreview.plan.crowdedDays} 天包含多个条目。
              </p>
            ) : null}
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className={th.btnGhost} disabled={busy} onClick={() => setDeferPreview(null)}>
                取消
              </button>
              <button type="button" className={th.btn} disabled={busy} onClick={() => void commitDefer()}>
                确认延后
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingWeek ? (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
          <div className={`max-w-md rounded-lg border ${th.line} ${th.panel} p-6 shadow-2xl`}>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#c8aa6e]">调度确认</p>
            <h2 className="mt-2 text-lg font-semibold text-[#ece8df]">最近一周已有该老板的宠幸计划</h2>
            <p className={`mt-3 text-sm leading-relaxed ${th.muted}`}>
              在目标日期前后各 3 天内，已存在同名角色/舰长条目。是否仍要继续添加或移动到此日期？
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className={th.btnGhost}
                disabled={busy}
                onClick={() => {
                  setPendingWeek(null);
                }}>
                取消
              </button>
              <button type="button" className={th.btn} disabled={busy} onClick={() => void confirmWeekOverlapAction()}>
                仍要继续
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {yearViewOpen !== null ? (
        <YearCalendarOverlay
          year={yearViewOpen}
          rows={rows}
          leaveDates={leaveDates}
          restDays={restDays}
          todayIso={todayIso}
          activeWeekStart={weekStart}
          onChangeYear={y => setYearViewOpen(y)}
          onPickWeek={iso => {
            setWeekStart(mondayIsoOfWeekContaining(iso));
            setYearViewOpen(null);
          }}
          onClose={() => setYearViewOpen(null)}
        />
      ) : null}
    </div>
  );
}

/**
 * 队列右键菜单：两个独立维度的延后入口
 * 坐标做视口边界夹取，否则在最后一行/最右侧会溢出
 */
function QueueContextMenu({
  menu,
  busy,
  onDefer,
}: {
  menu: QueueMenu;
  busy: boolean;
  onDefer: (item: HostingTodoDto, mode: 'days' | 'occurrences', n: number) => void;
}) {
  const [days, setDays] = useState('1');
  const [times, setTimes] = useState('1');

  const MENU_W = 248;
  const MENU_H = 208;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - MENU_H - 8));

  // 之前这里非法输入直接 return，点「执行」没有任何反馈，看着像坏了
  const [hint, setHint] = useState<string | null>(null);

  function run(mode: 'days' | 'occurrences', raw: string) {
    const t = raw.trim();
    if (!t) {
      setHint('请先填写数字');
      return;
    }
    const n = Number(t);
    if (!Number.isInteger(n) || n < 1) {
      setHint('须为 ≥ 1 的整数');
      return;
    }
    if (n > MAX_DEFER_N) {
      setHint(`不能超过 ${MAX_DEFER_N}`);
      return;
    }
    setHint(null);
    onDefer(menu.item, mode, n);
  }

  return (
    <div
      data-queue-menu
      role="menu"
      style={{ left, top, width: MENU_W }}
      className={`fixed z-[210] rounded-md border ${th.line} ${th.panel} p-2.5 shadow-2xl`}>
      <p className={`mb-2 truncate px-1 font-mono text-[11px] ${th.muted}`} title={menu.item.roleName}>
        {menu.item.roleName} · {menu.item.todoDate}
      </p>

      <div className="flex flex-col gap-2">
        <div className="rounded border border-[#232b38] bg-[#0a0d12] p-2">
          <label className={`mb-1.5 block text-[11px] ${th.muted}`}>以此节点延后（天）</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={MAX_DEFER_N}
              className={`${th.input} w-full px-2 py-1 text-sm`}
              value={days}
              disabled={busy}
              onChange={e => setDays(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') run('days', days);
              }}
            />
            <button
              type="button"
              className={`${th.btn} shrink-0 px-2.5 py-1 text-[11px]`}
              disabled={busy}
              onClick={() => run('days', days)}>
              执行
            </button>
          </div>
        </div>

        <div className="rounded border border-[#232b38] bg-[#0a0d12] p-2">
          <label className={`mb-1.5 block text-[11px] ${th.muted}`}>以此节点延后（次）</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={MAX_DEFER_N}
              className={`${th.input} w-full px-2 py-1 text-sm`}
              value={times}
              disabled={busy}
              onChange={e => setTimes(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') run('occurrences', times);
              }}
            />
            <button
              type="button"
              className={`${th.btn} shrink-0 px-2.5 py-1 text-[11px]`}
              disabled={busy}
              onClick={() => run('occurrences', times)}>
              执行
            </button>
          </div>
        </div>
      </div>

      {hint ? <p className="mt-2 px-1 text-[11px] text-rose-300">{hint}</p> : null}
    </div>
  );
}

function YearCalendarOverlay({
  year,
  rows,
  leaveDates,
  restDays,
  todayIso,
  activeWeekStart,
  onChangeYear,
  onPickWeek,
  onClose,
}: {
  year: number;
  rows: HostingTodoDto[];
  leaveDates: string[];
  restDays: IsoWeekday[];
  todayIso: string;
  activeWeekStart: string;
  onChangeYear: (y: number) => void;
  onPickWeek: (iso: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.todoDate, (m.get(r.todoDate) ?? 0) + 1);
    return m;
  }, [rows]);
  const leaveSet = useMemo(() => new Set(leaveDates), [leaveDates]);

  const activeWeek = useMemo(() => new Set(isoDatesCurrentWeek(activeWeekStart)), [activeWeekStart]);

  return (
    <>
      <button
        type="button"
        aria-label="关闭年视图"
        className="fixed inset-0 z-[150] cursor-default bg-black/65 backdrop-blur-[1px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="按月/年浏览排期"
        className={`fixed left-1/2 top-1/2 z-[151] flex max-h-[88vh] w-[min(94vw,1080px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border ${th.line} ${th.panel} shadow-2xl`}>
        <div className={`flex shrink-0 items-center justify-between gap-3 border-b ${th.line} px-4 py-3`}>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`${th.btnGhost} px-2 py-1 text-xs`}
              onClick={() => onChangeYear(year - 1)}
              title="上一年">
              〈
            </button>
            <span className={`font-mono text-base font-semibold ${th.gold}`}>{year} 年</span>
            <button
              type="button"
              className={`${th.btnGhost} px-2 py-1 text-xs`}
              onClick={() => onChangeYear(year + 1)}
              title="下一年">
              〉
            </button>
            <button
              type="button"
              className={`${th.btnGhost} ml-1 px-2 py-1 text-xs`}
              onClick={() => onChangeYear(parseIsoDateParts(todayIso).year)}>
              本年
            </button>
          </div>
          <button type="button" className={`${th.btnGhost} px-2 py-1 text-xs`} onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
            <YearMiniMonth
              key={month}
              year={year}
              month={month}
              countByDate={countByDate}
              leaveSet={leaveSet}
              restDays={restDays}
              todayIso={todayIso}
              activeWeek={activeWeek}
              onPick={onPickWeek}
            />
          ))}
        </div>

        <p className={`shrink-0 border-t ${th.line} px-4 py-2 text-center text-[11px] ${th.muted}`}>
          点击任意一天 · 跳到该日所在周 · 黄圈=今日 · 金色背景=有任务 · 红下划线=请假 · 灰字=固休
        </p>
      </div>
    </>
  );
}

function YearMiniMonth({
  year,
  month,
  countByDate,
  leaveSet,
  restDays,
  todayIso,
  activeWeek,
  onPick,
}: {
  year: number;
  month: number;
  countByDate: Map<string, number>;
  leaveSet: Set<string>;
  restDays: IsoWeekday[];
  todayIso: string;
  activeWeek: Set<string>;
  onPick: (iso: string) => void;
}) {
  const grid = useMemo(() => monthCalendarGrid(year, month), [year, month]);
  const monthLabel = `${year}.${String(month).padStart(2, '0')}`;
  return (
    <div className={`rounded-md border ${th.line} bg-[#0a0c10] p-2`}>
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className={`font-mono text-xs font-semibold ${th.gold}`}>{monthLabel}</span>
        <span className={`font-mono text-[10px] ${th.muted}`}>{month} 月</span>
      </div>
      <div className="grid grid-cols-7 gap-px">
        {['一', '二', '三', '四', '五', '六', '日'].map(d => (
          <span key={d} className={`py-0.5 text-center font-mono text-[9px] ${th.muted}`}>
            {d}
          </span>
        ))}
        {grid.flat().map(iso => {
          const parts = parseIsoDateParts(iso);
          const inMonth = parts.month === month;
          const count = countByDate.get(iso) ?? 0;
          const leave = leaveSet.has(iso);
          const rest = isWeeklyRestDate(iso, restDays);
          const isToday = iso === todayIso;
          const inActive = activeWeek.has(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onPick(iso)}
              title={`${iso}${count ? ` · ${count} 项` : ''}${leave ? ' · 已请假' : ''}${rest ? ' · 固休' : ''}`}
              className={`relative flex aspect-square items-center justify-center rounded text-[10px] tabular-nums transition ${
                !inMonth ? 'text-[#3a4150]' : rest && !leave ? 'text-[#7b8493]' : 'text-[#d4cfc4]'
              } ${
                inActive ? 'ring-1 ring-[#c8aa6e]/60' : ''
              } ${
                count > 0 && inMonth ? 'bg-[#c8aa6e]/15 font-semibold text-[#e8d49a]' : 'hover:bg-[#1a2230]'
              } ${isToday ? 'outline outline-1 outline-amber-400/70' : ''} ${leave && inMonth ? 'underline decoration-rose-500 decoration-2 underline-offset-[2px]' : ''}`}>
              {parts.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

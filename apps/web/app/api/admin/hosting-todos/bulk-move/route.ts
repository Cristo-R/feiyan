import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAdminFromRequest } from '@/lib/admin-session';
import { bulkMoveHostingTodos, getSiteSetting, listHostingLeaveDates, listHostingTodos } from '@/lib/db';
import { REST_SETTING_KEY, isWeeklyRestDate, parseWeeklyRestDays } from '@/lib/hosting-rest-days';
import { normalizeRoleName } from '@/lib/hosting-todo-schedule';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 批量改期（队列延后的落库入口）
 *
 * 客户端算出的 plan 不可信：这里重新校验 id 存在性、日期格式，
 * 并基于库内真实数据重跑「同日同角色重复」检查。
 * 一周内重复（weekNeedsAck）不拦 —— 批量延后必然大量触发，
 * 与 batch-import 的既有做法一致。
 */
export async function PUT(req: NextRequest) {
  const session = await getAdminFromRequest(req);
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const raw = o.moves;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json({ error: 'moves 不能为空' }, { status: 400 });
  }
  if (raw.length > 500) {
    return NextResponse.json({ error: '单次改期条目过多（上限 500）' }, { status: 400 });
  }

  const moves: { id: number; toDate: string }[] = [];
  const seenIds = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i] as Record<string, unknown>;
    if (!m || typeof m !== 'object') {
      return NextResponse.json({ error: `第 ${i + 1} 条格式错误` }, { status: 400 });
    }
    const id = Number(m.id);
    const toDate = String(m.toDate ?? '').trim();
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: `第 ${i + 1} 条 id 无效` }, { status: 400 });
    }
    if (!DATE_RE.test(toDate)) {
      return NextResponse.json({ error: `第 ${i + 1} 条日期格式须为 YYYY-MM-DD` }, { status: 400 });
    }
    if (seenIds.has(id)) {
      return NextResponse.json({ error: `第 ${i + 1} 条 id 重复` }, { status: 400 });
    }
    seenIds.add(id);
    moves.push({ id, toDate });
  }

  try {
    const all = await listHostingTodos();
    const byId = new Map(all.map(r => [r.id, r]));
    for (const mv of moves) {
      if (!byId.has(mv.id)) {
        return NextResponse.json({ error: `条目 ${mv.id} 不存在，请刷新后重试` }, { status: 409 });
      }
    }

    /*
     * 以服务端当前状态重算「可用日」，不信客户端的 plan。
     * 场景：A 打开看板后，B 把某天标成请假，A 再延后 —— A 的 plan 基于旧数据，
     * 会把条目放到请假日上。请假是硬约束，必须在这里拦住。
     */
    const leaveDates = new Set(await listHostingLeaveDates());
    const restDays = parseWeeklyRestDays(await getSiteSetting(REST_SETTING_KEY));
    const occupiedBefore = new Set(all.map(r => r.todo_date));
    for (const mv of moves) {
      if (leaveDates.has(mv.toDate)) {
        return NextResponse.json(
          { code: 'DATE_UNAVAILABLE', error: `${mv.toDate} 已被标记请假，请刷新后重新计算延后` },
          { status: 409 },
        );
      }
      // 固休日仅在「延后前已有安排」时可用，与前端 isAvailable 同一规则
      if (isWeeklyRestDate(mv.toDate, restDays) && !occupiedBefore.has(mv.toDate)) {
        return NextResponse.json(
          { code: 'DATE_UNAVAILABLE', error: `${mv.toDate} 是无安排的固休日，请刷新后重新计算延后` },
          { status: 409 },
        );
      }
    }

    // 以改期后的分布重跑同日同角色检查
    const moveMap = new Map(moves.map(m => [m.id, m.toDate]));
    const seen = new Map<string, Set<string>>();
    for (const r of all) {
      const date = moveMap.get(r.id) ?? r.todo_date;
      const role = normalizeRoleName(r.role_name);
      if (!role) continue;
      let bucket = seen.get(date);
      if (!bucket) {
        bucket = new Set();
        seen.set(date, bucket);
      }
      if (bucket.has(role)) {
        return NextResponse.json(
          { code: 'SAME_DAY_ROLE', error: `改期后 ${date} 会出现「${r.role_name}」重复，已取消本次延后` },
          { status: 409 },
        );
      }
      bucket.add(role);
    }

    const ok = await bulkMoveHostingTodos(moves);
    if (!ok) return NextResponse.json({ error: '批量改期失败，已回滚' }, { status: 500 });
    return NextResponse.json({ ok: true, moved: moves.length });
  } catch (e) {
    console.error('[hosting-todos bulk-move PUT]', e);
    return NextResponse.json({ error: '批量改期失败' }, { status: 500 });
  }
}

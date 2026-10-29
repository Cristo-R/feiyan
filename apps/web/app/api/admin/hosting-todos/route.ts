import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAdminFromRequest } from '@/lib/admin-session';
import { createHostingTodo, getSiteSetting, listHostingLeaveDates, listHostingTodos } from '@/lib/db';
import { REST_SETTING_KEY, parseWeeklyRestDays } from '@/lib/hosting-rest-days';
import { analyzeRoleScheduleConflict } from '@/lib/hosting-todo-schedule';
import { DEFAULT_HOST_TYPE, parseHostType } from '@/lib/hosting-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function mapRow(r: Awaited<ReturnType<typeof listHostingTodos>>[number]) {
  return {
    id: r.id,
    todoDate: r.todo_date,
    roleName: r.role_name,
    hostType: r.host_type,
    stuckTask: !!r.stuck_task,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminFromRequest(req);
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const rows = await listHostingTodos();
    const leaveDates = await listHostingLeaveDates();
    // 返回规则本体而非当周展开结果：看板需要跨周判断（延后计算会越过展示周）
    const restDays = parseWeeklyRestDays(await getSiteSetting(REST_SETTING_KEY));
    return NextResponse.json({ data: rows.map(mapRow), leaveDates, restDays });
  } catch (e) {
    console.error('[hosting-todos GET]', e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: process.env.NODE_ENV === 'development' ? `加载失败: ${msg}` : '加载任务板失败' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getAdminFromRequest(req);
  if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const todoDate = String(o.todoDate ?? '').trim();
  if (!DATE_RE.test(todoDate)) return NextResponse.json({ error: '日期格式须为 YYYY-MM-DD' }, { status: 400 });
  const roleName = String(o.roleName ?? '').trim();
  if (!roleName) return NextResponse.json({ error: '角色名不能为空' }, { status: 400 });
  const ht = parseHostType(o.hostType);
  const host_type = ht ?? DEFAULT_HOST_TYPE;
  const stuck = Boolean(o.stuckTask);
  const confirmWeek = Boolean(o.confirmWeekOverlap);
  // 关联舰长唯一 id（拖入舰长池时携带；手动输入角色名时为空）
  const captainIdRaw = o.captainId;
  const captain_id =
    captainIdRaw == null || captainIdRaw === '' || !Number.isFinite(Number(captainIdRaw))
      ? null
      : Number(captainIdRaw);

  const all = await listHostingTodos();
  const conflict = analyzeRoleScheduleConflict(all, { targetDate: todoDate, roleName, excludeId: undefined });
  if (conflict.sameDayBlocked) {
    return NextResponse.json(
      { code: 'SAME_DAY_ROLE', error: '当日已有该角色/舰长安排，不可重复添加' },
      { status: 409 },
    );
  }
  if (conflict.weekNeedsAck && !confirmWeek) {
    return NextResponse.json(
      {
        code: 'WEEK_ROLE_OVERLAP',
        error: '最近一周已有该老板的宠幸计划',
        requiresConfirm: true,
      },
      { status: 409 },
    );
  }

  const id = await createHostingTodo({
    todo_date: todoDate,
    role_name: roleName,
    host_type,
    stuck_task: stuck ? 1 : 0,
    captain_id,
  });
  return NextResponse.json({ ok: true, data: { id } });
}

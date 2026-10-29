import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { captainAvatarUrlForPublicSite, captainRowToDto, type CaptainApiDto } from '@/lib/captain-dto';
import { captainScheduleName } from '@/lib/captain-schedule-name';
import { getSiteSetting, listCaptains, listHostingLeaveDates, listHostingTodos } from '@/lib/db';
import { REST_SETTING_KEY, filterRestDates, parseWeeklyRestDays } from '@/lib/hosting-rest-days';
import { DEFAULT_HOST_TYPE, isHostType } from '@/lib/hosting-types';
import {
  isValidIsoDate,
  isoDatesCurrentWeek,
  mondayIsoOfWeekContaining,
  todayIsoDate,
} from '@/lib/hosting-week-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const weekStartParam = url.searchParams.get('weekStart');
    const baseIso = isValidIsoDate(weekStartParam ?? '')
      ? mondayIsoOfWeekContaining(weekStartParam!)
      : todayIsoDate();
    const weekDates = isoDatesCurrentWeek(baseIso);
    const set = new Set(weekDates);
    const [rows, capRows, leaveAll] = await Promise.all([listHostingTodos(), listCaptains(), listHostingLeaveDates()]);
    const captains = capRows.map(captainRowToDto);

    function findCaptain(roleName: string): CaptainApiDto | null {
      const n = roleName.trim();
      for (const c of captains) {
        if (captainScheduleName(c) === n) return c;
      }
      return null;
    }

    const todos = rows
      .filter(r => set.has(r.todo_date))
      .map(r => {
        const hostType = isHostType(r.host_type) ? r.host_type : DEFAULT_HOST_TYPE;
        const cap = findCaptain(r.role_name);
        const captainId = cap?.id ?? null;
        return {
          id: r.id,
          todoDate: r.todo_date,
          roleName: r.role_name,
          hostType,
          stuckTask: !!r.stuck_task,
          sortOrder: r.sort_order,
          captainId,
          avatarUrl: cap ? captainAvatarUrlForPublicSite(cap) : null,
          avatarUpdatedAt: cap ? cap.updatedAt : null,
        };
      })
      .sort(
        (a, b) =>
          a.todoDate.localeCompare(b.todoDate) || a.sortOrder - b.sortOrder || a.id - b.id,
      );

    const leaveDates = leaveAll.filter(d => set.has(d));
    // 固休与请假分开返回：前台样式需要区分（灰「固休」vs 红框「已请假」）
    const restDays = parseWeeklyRestDays(await getSiteSetting(REST_SETTING_KEY));
    const restDates = filterRestDates(weekDates, restDays);

    // 同时返回规则本体：月视图跨越整月，当周展开结果不够用
    return NextResponse.json({ data: { weekDates, todos, leaveDates, restDates, restDays } });
  } catch (e) {
    console.error('[site/hosting-week]', e);
    return NextResponse.json({ error: '加载失败' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import type { PetCaptain } from '@/components/site-pet/petTypes';
import { captainScheduleName } from '@/lib/captain-schedule-name';
import { listCaptains, listHostingTodos } from '@/lib/db';
import { todayIsoDate } from '@/lib/hosting-week-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [captains, todos] = await Promise.all([listCaptains(), listHostingTodos()]);
    const today = todayIsoDate();
    const upcoming = todos.filter(todo => todo.todo_date >= today);
    const data: PetCaptain[] = captains.map(captain => {
      const name = captainScheduleName({
        id: captain.id,
        uid: captain.uid,
        idName: captain.id_name,
        remarkName: captain.remark_name,
      });
      // 新排班按舰长 ID 匹配；没有关联 ID 的旧排班沿用任务板名称。
      const next = upcoming.find(todo => todo.captain_id === captain.id
        || (todo.captain_id === null && todo.role_name.trim() === name));
      return { id: captain.id, name, nextDate: next?.todo_date ?? null };
    });
    data.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.id - b.id);
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('[site/pet-captains]', error);
    return NextResponse.json({ error: '舰长和排班暂时加载失败，请稍后重试' }, { status: 500 });
  }
}

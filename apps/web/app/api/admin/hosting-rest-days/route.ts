import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAdminFromRequest } from '@/lib/admin-session';
import { getSiteSetting, setSiteSetting } from '@/lib/db';
import { REST_SETTING_KEY, parseWeeklyRestDays } from '@/lib/hosting-rest-days';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await getAdminFromRequest(req);
    if (!session) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const restDays = parseWeeklyRestDays(await getSiteSetting(REST_SETTING_KEY));
    return NextResponse.json({ data: restDays });
  } catch (e) {
    console.error('[hosting-rest-days GET]', e);
    return NextResponse.json({ error: '加载固休配置失败' }, { status: 500 });
  }
}

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
  const raw = o.restDays;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'restDays 须为周几编号数组（1=周一 … 7=周日）' }, { status: 400 });
  }
  // 宽松解析会丢弃非法值；若原数组非空但全被丢弃，说明入参有误
  // 任一非法成员即拒绝，不静默截断：[1,99] 以前会存成 [1] 并返回 200
  const restDays = parseWeeklyRestDays(raw);
  const distinctInput = new Set(raw.map(v => Number(v))).size;
  if (restDays.length !== distinctInput) {
    return NextResponse.json({ error: '周几编号须在 1-7 之间' }, { status: 400 });
  }
  if (restDays.length === 7) {
    return NextResponse.json({ error: '不能把 7 天全部设为固休' }, { status: 400 });
  }

  try {
    await setSiteSetting(REST_SETTING_KEY, restDays);
    return NextResponse.json({ ok: true, data: restDays });
  } catch (e) {
    console.error('[hosting-rest-days PUT]', e);
    return NextResponse.json({ error: '保存固休配置失败' }, { status: 500 });
  }
}

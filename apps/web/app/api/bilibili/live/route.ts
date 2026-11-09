import { NextResponse } from 'next/server';
import { getLiveStatus } from '@/lib/bilibili';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const uid = process.env.BILIBILI_UID;
    if (!uid) return NextResponse.json({ success: false, message: 'BILIBILI_UID not set' }, { status: 500 });
    const data = await getLiveStatus(uid);
    return NextResponse.json({ success: true, data });
  } catch (e: unknown) {
    return NextResponse.json({ success: false, message: e instanceof Error ? e.message : 'error' }, { status: 500 });
  }
}

'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BilibiliUserInfo, BilibiliVideo, BilibiliLiveStatus } from '@/types/bilibili';
import EdgeCalendarFloat from '@/components/EdgeCalendarFloat';
import SitePet from '@/components/SitePet';
import { DEFAULT_SITE_CONFIG } from '@/lib/site-defaults';
import type { SiteConfig } from '@/lib/site-config-types';

function fmt(n: number) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}千`;
  return String(n);
}
function fmtDate(ts: number) {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function HomePage() {
  const [cfg, setCfg] = useState<SiteConfig>(() => ({
    ...DEFAULT_SITE_CONFIG,
    ...(typeof process.env.NEXT_PUBLIC_CONTACT_EMAIL === 'string' && process.env.NEXT_PUBLIC_CONTACT_EMAIL
      ? { contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL }
      : {}),
  }));
  const [showTop, setShowTop] = useState(false);
  const [userInfo, setUserInfo] = useState<BilibiliUserInfo | null>(null);
  const [live, setLive] = useState<BilibiliLiveStatus | null>(null);
  const [videos, setVideos] = useState<BilibiliVideo[]>([]);
  const [videoTotal, setVideoTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [petLivePreview, setPetLivePreview] = useState<boolean | null>(null);

  const refreshLiveStatus = useCallback(async () => {
    try {
      const body = await fetch('/api/bilibili/live', { cache: 'no-store' }).then(r => r.json());
      setLive(body?.data || null);
    } catch {
      // 直播状态失败不影响主站展示；保留上一轮状态。
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const [u, l, v] = await Promise.all([
        fetch('/api/bilibili/user').then(r => r.json()).catch(() => null),
        fetch('/api/bilibili/live').then(r => r.json()).catch(() => null),
        fetch('/api/bilibili/videos?pageSize=9').then(r => r.json()).catch(() => null),
      ]);
      setUserInfo(u?.data || null);
      setLive(l?.data || null);
      setVideos(v?.data?.videos || []);
      setVideoTotal(v?.data?.total || 0);
    } catch {
      setLoadError('接口暂不可用，请确认已配置 BILIBILI_UID');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch('/api/site-config')
      .then(r => r.json() as Promise<{ data?: SiteConfig }>)
      .then(body => {
        if (body?.data) {
          setCfg(prev => ({
            ...prev,
            ...body.data!,
            contactEmail: body.data!.contactEmail || prev.contactEmail,
          }));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 380);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const preview = new URLSearchParams(window.location.search).get('petLive');
    setPetLivePreview(preview === '1' ? true : preview === '0' ? false : null);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshLiveStatus();
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refreshLiveStatus]);

  const spaceUrl = useMemo(() => {
    const uid = userInfo?.mid || '14636839'; // 后备使用 .env.local 中的 BILIBILI_UID
    return `https://space.bilibili.com/${uid}`;
  }, [userInfo?.mid]);
  const petLiveActive = petLivePreview ?? (live?.live_status === 1);
  const heroSubtitle = (userInfo?.sign?.trim()) || cfg.defaultSign;
  const faceUrl = userInfo?.face || '/default-avatar.jpg';
  const displayNick = userInfo?.name || cfg.siteName;

  return (
    <div className="min-h-screen bg-white text-[#333]">
      <header className="sticky top-0 z-50 border-b border-gray-100/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3.5 md:px-8">
          <a href="#intro" className="font-bold tracking-tight">
            {cfg.siteName}<span className="ml-2 hidden font-normal text-[#888] sm:inline">{cfg.headerSubtitle}</span>
          </a>
          <nav className="hidden flex-1 justify-center md:flex">
            <ul className="flex gap-6 text-sm text-[#444] lg:gap-8">
              {cfg.navLinks.map(l => <li key={l.href}><a href={l.href} className="hover:text-[#00A1D6]">{l.label}</a></li>)}
            </ul>
          </nav>
          <a href={spaceUrl} target="_blank" rel="noopener noreferrer"
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-[#333] transition hover:border-[#00A1D6] hover:text-[#00A1D6]">
            B站主页
          </a>
        </div>
      </header>

      {loadError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">{loadError}</div>
      )}

      {live?.live_status === 1 && live.url && (
        <a href={live.url} target="_blank" rel="noopener noreferrer"
          className="block bg-gradient-to-r from-[#1a1f2e] to-[#0A0E14] px-4 py-3 text-center text-sm text-white transition hover:opacity-95">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
          正在直播：{live.title || '进入直播间'}
          <span className="ml-2 text-[#E8B84B]">→</span>
        </a>
      )}

      <section id="intro" className="relative scroll-mt-20 overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_#1a2838_0%,_#0A0E14_55%,_#06080c_100%)]">
        <div className="pointer-events-none absolute -right-24 top-16 h-64 w-64 rounded-full bg-[#E8B84B]/10 blur-3xl" />
        <div className="relative mx-auto flex max-w-5xl flex-col gap-12 px-4 pb-20 pt-16 md:flex-row md:items-stretch md:px-8 md:pb-24 md:pt-20">
          <div className="hidden w-1 shrink-0 rounded-full bg-gradient-to-b from-[#E8B84B] via-[#E8B84B]/40 to-transparent md:block" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium tracking-wide text-[#E8B84B]/90">B站 UP 主 · {loading ? '…' : displayNick}</p>
            <h1 className="mt-4 text-[1.65rem] font-bold leading-snug text-white md:text-4xl md:leading-tight">
              {cfg.heroTitlePart1}<span className="text-[#E8B84B]">{cfg.heroTitleAccent}</span>{cfg.heroTitlePart2}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-white/75">{heroSubtitle}</p>
            <div className="mt-8 flex flex-wrap gap-2">
              {cfg.heroPills.map(p => (
                <span key={p} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-white/85">{p}</span>
              ))}
            </div>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <a href={spaceUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex rounded-lg bg-[#E8B84B] px-6 py-3 text-sm font-semibold text-black shadow-lg transition hover:brightness-110">
                前往 B 站
              </a>
              {live?.live_status === 1 && live.url && (
                <a href={live.url} target="_blank" rel="noopener noreferrer"
                  className="text-sm font-medium text-white/80 underline-offset-4 hover:text-white hover:underline">
                  正在直播
                </a>
              )}
              <a href="#videos" className="text-sm font-medium text-white/60 hover:text-white/90">查看投稿</a>
            </div>
          </div>
          {faceUrl && (
            <div className="flex shrink-0 items-end justify-center md:w-[280px] lg:w-[320px]">
              <div className="relative w-full max-w-xs">
                <div className="absolute -inset-3 rounded-2xl bg-gradient-to-tr from-[#E8B84B]/20 to-transparent" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={faceUrl} alt="" className="relative aspect-square w-full rounded-xl object-cover ring-2 ring-white/10" loading="eager" referrerPolicy="no-referrer" />
              </div>
            </div>
          )}
        </div>
      </section>

      <section id="videos" className="scroll-mt-20 px-4 py-20 md:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold md:text-3xl">{cfg.videosSectionTitle}</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-[#666]">{cfg.videosSectionIntro}</p>
          {loading ? (
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map(k => (
                <div key={k} className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="aspect-video animate-pulse bg-gray-200" />
                  <div className="space-y-3 p-5">
                    <div className="h-5 w-4/5 animate-pulse rounded bg-gray-200" />
                    <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : videos.length === 0 ? (
            <div className="mt-14 flex flex-col items-center rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center">
              <h3 className="mt-5 text-xl font-bold text-[#222]">{cfg.emptyVideosTitle}</h3>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-[#666]">{cfg.emptyVideosBody}</p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button type="button" onClick={loadData} className="rounded-lg bg-[#0A0E14] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0A0E14]/90">刷新稿件</button>
                {userInfo?.mid && <a href={spaceUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-[#333] transition hover:bg-gray-50">去 B 站空间</a>}
              </div>
            </div>
          ) : (
            <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {videos.slice(0, 6).map(v => (
                <article key={v.bvid} className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md">
                  <a href={`https://www.bilibili.com/video/${v.bvid}`} target="_blank" rel="noopener noreferrer" className="relative aspect-video overflow-hidden bg-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={v.pic} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" referrerPolicy="no-referrer" />
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">{v.length}</span>
                  </a>
                  <div className="flex flex-1 flex-col p-5">
                    <h3 className="text-base font-bold leading-snug text-[#222] group-hover:text-[#00A1D6]">
                      <a href={`https://www.bilibili.com/video/${v.bvid}`} target="_blank" rel="noopener noreferrer">{v.title}</a>
                    </h3>
                    <p className="mt-2 flex-1 line-clamp-2 text-sm text-[#666]">{v.description || ' '}</p>
                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#999]">
                      <span>{fmtDate(v.created)}</span>
                      <span>{fmt(v.play)} 播放</span>
                      {v.video_review > 0 && <span>{fmt(v.video_review)} 评论</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {videos.length > 0 && (
            <div className="mt-10 text-center">
              <a
                href={spaceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-[#333] transition hover:border-[#00A1D6] hover:bg-gray-50 hover:text-[#00A1D6]">
                查看全部{videoTotal > 0 ? ` ${videoTotal}` : ''} 支稿件
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </a>
            </div>
          )}
        </div>
      </section>

      <footer id="contact" className="scroll-mt-20 border-t border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-5xl px-4 py-14 md:px-8">
          <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="font-semibold text-[#222]">{cfg.siteName}{cfg.headerSubtitle}</p>
              <p className="mt-1 text-sm text-[#666]">{cfg.footerTagline}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              {userInfo?.mid && (
                <a href={spaceUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex w-fit items-center rounded-lg bg-[#00A1D6] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90">
                  B 站主页
                </a>
              )}
            </div>
          </div>
          <p className="mt-10 text-center text-xs text-[#999]">© {new Date().getFullYear()} {cfg.siteName} · {cfg.footerNote}</p>
          {cfg.footerIcpText.trim() !== '' && (
            <p className="mt-2 text-center text-xs text-[#999]">
              <a
                href="https://beian.miit.gov.cn/"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[#00A1D6] hover:underline">
                {cfg.footerIcpText}
              </a>
            </p>
          )}
          <p className="mt-3 text-center text-xs text-[#888] leading-relaxed max-w-3xl mx-auto">
            本站为个人UP主展示页面，所涉及的游戏内容、截图、素材等版权归原游戏开发商及发行商所有。<br />
            本站内容仅用于个人作品展示与交流学习，不用于商业用途。如有侵权，请联系删除。
          </p>
          <p className="mt-2 text-center text-xs text-[#999]">
            Built with{' '}
            <a
              href="https://juejin.cn/user/3054881490875738"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#00A1D6] hover:underline">
              Jahzo
            </a>
            {' & '}
            <a
              href="https://space.bilibili.com/5632308"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#00A1D6] hover:underline">
              喝喝喝喝阔落
            </a>
          </p>
        </div>
      </footer>

      <EdgeCalendarFloat />
      <SitePet liveActive={petLiveActive} />

      {showTop && (
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-8 right-5 z-40 rounded-full border border-gray-200 bg-white p-3 text-[#444] shadow-lg hover:bg-gray-50 max-md:bottom-[5.25rem] md:right-6"
          aria-label="回到顶部">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
        </button>
      )}
    </div>
  );
}

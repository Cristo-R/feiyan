import type { Metadata } from 'next';
import { PET_IDLE_SRC } from '@/components/site-pet/petActions';
import './globals.css';

export const metadata: Metadata = {
  title: '斐延 · 个人主站',
  description: 'B站UP主斐延的个人主页，分享游戏内容与攻略',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link
          rel="preload"
          href={PET_IDLE_SRC}
          as="fetch"
          type="image/webp"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

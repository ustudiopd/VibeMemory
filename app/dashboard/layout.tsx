'use client';

import MobileTabBar from '@/components/MobileTabBar';
import { usePathname } from 'next/navigation';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isProjectDetail = pathname?.startsWith('/dashboard/projects/');

  return (
    <>
      {children}
      {/* 프로젝트 상세 페이지가 아닐 때만 MobileTabBar 표시 */}
      {!isProjectDetail && <MobileTabBar />}
    </>
  );
}


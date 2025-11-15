'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import MobileMoreMenu from './MobileMoreMenu';

interface Tab {
  id: string;
  label: string;
  icon: string;
  path: string | null;
}

const tabs: Tab[] = [
  { id: 'dashboard', label: '대시보드', icon: '🏠', path: '/dashboard' },
  { id: 'import', label: '가져오기', icon: '➕', path: '/dashboard/import' },
  { id: 'more', label: '더보기', icon: '⋯', path: null },
];

export default function MobileTabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  // 프로젝트 상세 페이지인지 확인
  const isProjectDetail = pathname?.startsWith('/dashboard/projects/');

  const handleTabClick = (tab: Tab) => {
    if (tab.id === 'more') {
      setShowMoreMenu(true);
    } else if (tab.path) {
      router.push(tab.path);
    }
  };

  const isActive = (tab: Tab) => {
    if (tab.id === 'more') return false;
    if (tab.path === '/dashboard') {
      return pathname === '/dashboard' && !isProjectDetail;
    }
    if (tab.path === '/dashboard/import') {
      return pathname === '/dashboard/import';
    }
    return pathname === tab.path;
  };

  return (
    <>
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-bottom z-50 shadow-lg">
        <div className="flex justify-around items-center h-16">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab)}
              className={`
                flex flex-col items-center justify-center flex-1 h-full
                transition-colors duration-200
                ${isActive(tab)
                  ? 'text-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
                }
                min-h-[44px] touch-manipulation
                active:bg-gray-100
              `}
              aria-label={tab.label}
            >
              <span className="text-2xl mb-0.5">{tab.icon}</span>
              <span className="text-xs font-medium">{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
      
      {/* 하단 탭바를 위한 여백 */}
      <div className="md:hidden h-16 safe-bottom" />
      
      {/* 더보기 메뉴 */}
      <MobileMoreMenu
        isOpen={showMoreMenu}
        onClose={() => setShowMoreMenu(false)}
        projectId={isProjectDetail ? pathname?.split('/')[3] : undefined}
      />
    </>
  );
}


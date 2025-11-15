'use client';

import { useRouter } from 'next/navigation';

interface MobileMoreMenuProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
}

export default function MobileMoreMenu({ isOpen, onClose, projectId }: MobileMoreMenuProps) {
  const router = useRouter();

  if (!isOpen) return null;

  const menuItems = [
    ...(projectId
      ? [
          {
            id: 'rescan',
            label: '재스캔',
            icon: '🔄',
            onClick: () => {
              // 프로젝트 상세 페이지에서 재스캔 버튼 클릭 이벤트 트리거
              const rescanButton = document.querySelector('[data-rescan-button]') as HTMLButtonElement;
              if (rescanButton) {
                rescanButton.click();
              }
              onClose();
            },
          },
        ]
      : []),
    {
      id: 'help',
      label: '도움말',
      icon: '📚',
      onClick: () => {
        // 향후 구현
        alert('도움말 기능은 곧 제공될 예정입니다.');
        onClose();
      },
    },
    {
      id: 'info',
      label: '정보',
      icon: 'ℹ️',
      onClick: () => {
        // 향후 구현
        alert('VibeMemory v1.0\n개발자 지식 자산 관리 시스템');
        onClose();
      },
    },
  ];

  return (
    <>
      {/* 오버레이 */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-50 md:hidden"
        onClick={onClose}
      />
      
      {/* 바텀 시트 */}
      <div
        className={`
          fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50
          md:hidden safe-bottom
          transform transition-transform duration-300 ease-out
          ${isOpen ? 'translate-y-0' : 'translate-y-full'}
        `}
      >
        <div className="p-4">
          {/* 드래그 핸들 */}
          <div className="flex justify-center mb-4">
            <div className="w-12 h-1 bg-gray-300 rounded-full" />
          </div>
          
          {/* 메뉴 헤더 */}
          <h3 className="text-lg font-semibold text-gray-900 mb-4 px-2">더보기</h3>
          
          {/* 메뉴 항목 */}
          <div className="space-y-1">
            {menuItems.map((item) => (
              <button
                key={item.id}
                onClick={item.onClick}
                className="
                  w-full flex items-center px-4 py-3 text-left
                  text-gray-900 hover:bg-gray-100 active:bg-gray-200
                  rounded-lg transition-colors duration-150
                  min-h-[44px] touch-manipulation
                "
              >
                <span className="text-2xl mr-3">{item.icon}</span>
                <span className="text-base font-medium">{item.label}</span>
              </button>
            ))}
          </div>
          
          {/* 닫기 버튼 */}
          <button
            onClick={onClose}
            className="
              w-full mt-4 px-4 py-3
              text-gray-600 hover:bg-gray-100 active:bg-gray-200
              rounded-lg transition-colors duration-150
              min-h-[44px] touch-manipulation
              font-medium
            "
          >
            닫기
          </button>
        </div>
      </div>
    </>
  );
}


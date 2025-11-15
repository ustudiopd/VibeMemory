import MobileTabBar from '@/components/MobileTabBar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <MobileTabBar />
    </>
  );
}


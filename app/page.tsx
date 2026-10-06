"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { LoginForm } from "@/components/login-form";
import { UserCalendar } from "@/components/user-calendar";
import { AdminDashboard } from "@/components/admin-dashboard";
import { AdminCalendar } from "@/components/admin-calendar";
import { QuarterBalance } from "@/components/quarter-balance";
import { cn } from "@/lib/utils";

type AdminView = "calendar" | "dashboard" | "quarter";

export default function Home() {
  const { employee, isReady, isAdmin } = useAuth();
  const [adminView, setAdminView] = useState<AdminView>("dashboard");

  if (!isReady) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }

  if (!employee) return <LoginForm />;

  if (!isAdmin) return <UserCalendar />;

  // 관리자: 대시보드 / 본인 캘린더 전환
  return (
    <div className="flex flex-col min-h-dvh">
      <div className="flex-1 pb-18">
        {adminView === "dashboard" ? (
          <AdminDashboard />
        ) : adminView === "quarter" ? (
          <QuarterBalance />
        ) : (
          <AdminCalendar />
        )}
      </div>
      <nav aria-label="관리자 화면" className="fixed bottom-0 left-0 z-50 flex w-full border-t bg-background/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_20px_rgba(13,37,61,0.05)] backdrop-blur">
        {(
          [
            { label: "통합 관리", value: "dashboard" },
            { label: "분기 휴무 검증", value: "quarter" },
            { label: "내 캘린더", value: "calendar" },
          ] as { label: string; value: AdminView }[]
        ).map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-current={adminView === tab.value ? "page" : undefined}
            className={cn(
              "min-h-14 flex-1 border-t-2 px-1 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-sm",
              adminView === tab.value
                ? "border-primary bg-primary/5 text-primary"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
            onClick={() => setAdminView(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

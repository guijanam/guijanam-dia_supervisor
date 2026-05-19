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
      <div className="flex-1 pb-14">
        {adminView === "dashboard" ? (
          <AdminDashboard />
        ) : adminView === "quarter" ? (
          <QuarterBalance />
        ) : (
          <AdminCalendar />
        )}
      </div>
      <nav className="fixed bottom-0 left-0 w-full z-50 flex border-t bg-background">
        {(
          [
            { label: "통합 관리", value: "dashboard" },
            { label: "분기 휴무 검증", value: "quarter" },
            { label: "내 캘린더", value: "calendar" },
          ] as { label: string; value: AdminView }[]
        ).map((tab) => (
          <button
            key={tab.value}
            className={cn(
              "flex-1 py-3 font-bold text-sm transition-colors",
              adminView === tab.value
                ? "border-b-2 border-primary bg-accent"
                : "text-muted-foreground"
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

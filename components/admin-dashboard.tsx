"use client";

import { useState, useRef, type ComponentType } from "react";
import { useAuth } from "@/lib/auth-context";
import type {
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  DEFAULT_OFFICE_NAME,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { STAFF_EDIT_URL } from "@/components/staff-list-link";
import { AnnouncementAdminContent } from "@/components/announcement-admin";
import { DocumentAdminContent } from "@/components/document-admin";
import { JigeunCapSettings } from "@/components/jigeun-cap-settings";
import { RequestsPanel } from "@/components/admin-panels/requests-panel";
import { PinResetPanel } from "@/components/admin-panels/pin-reset-panel";
import { ReferenceEditPanel } from "@/components/admin-panels/reference-edit-panel";
import { WorkPatternPanel } from "@/components/admin-panels/work-pattern-panel";
import {
  LogOut,
  KeyRound,
  CalendarCog,
  Megaphone,
  FileText,
  Users,
  ClipboardList,
  Repeat,
} from "lucide-react";

type AdminPage =
  | "requests"
  | "announce"
  | "document"
  | "pin"
  | "reference"
  | "patterns";

function SidebarItem({
  icon: Icon,
  label,
  onClick,
  active = false,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent text-accent-foreground font-semibold"
          : "hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-foreground" : "text-muted-foreground"
        )}
      />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function AdminDashboard() {
  const { logout } = useAuth();
  const [page, setPage] = useState<AdminPage>("requests");

  // 헤더 freezeDate 배지 + JigeunCapSettings 가 쓰는 설정값 (RequestsPanel 이 통지)
  const [caps, setCaps] = useState<JigeunCaps>(DEFAULT_JIGEUN_CAPS);
  const [freezeDate, setFreezeDate] = useState<string | null>(null);
  const [weekendHolidayTurns, setWeekendHolidayTurns] = useState<string[]>(
    DEFAULT_WEEKEND_HOLIDAY_TURNS
  );
  const [jigeunTurns, setJigeunTurns] = useState<JigeunTurnSettings>(
    DEFAULT_JIGEUN_TURNS
  );
  const [holidayTurnRules, setHolidayTurnRules] = useState<HolidayTurnRule[]>(
    DEFAULT_HOLIDAY_TURN_RULES
  );
  const [officeName, setOfficeName] = useState<string>(DEFAULT_OFFICE_NAME);
  const [extraDeadline, setExtraDeadline] = useState<string | null>(null);
  const [extraYear, setExtraYear] = useState<number | null>(null);
  const [extraQuarter, setExtraQuarter] = useState<number | null>(null);
  // RequestsPanel 의 재조회 함수 — JigeunCapSettings 저장 후 호출
  const requestsRefreshRef = useRef<() => void>(() => {});

  const today = format(new Date(), "yyyy-MM-dd");
  // 추가 신청 기간은 1차 마감 다음날부터 추가 신청일까지다.
  const extraActive =
    !!extraDeadline && !!freezeDate && today > freezeDate && today <= extraDeadline;

  return (
    <div className="flex flex-col min-h-dvh">
      <header className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="text-sm">
            <span className="font-bold">관리자</span>
          </div>
          <span
            className={cn(
              "text-xs rounded px-1.5 py-0.5 border",
              freezeDate
                ? format(new Date(), "yyyy-MM-dd") > freezeDate
                  ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-900/50 dark:text-red-300"
                  : "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300"
                : "text-muted-foreground"
            )}
            title="사용자 지근/지휴 신청 마감일"
          >
            {freezeDate
              ? `마감 ${freezeDate}${
                  format(new Date(), "yyyy-MM-dd") > freezeDate
                    ? " (잠김)"
                    : ""
                }`
              : "마감 미설정"}
          </span>
          {extraDeadline && (
            <span
              className={cn(
                "text-xs rounded px-1.5 py-0.5 border",
                extraActive
                  ? "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-300"
                  : "text-muted-foreground"
              )}
              title={`추가 신청 기간 — ${extraYear}년 ${extraQuarter}분기 합계가 24 가 아닌 직원만 신청 가능(삭제 불가)`}
            >
              {`추가 ${extraDeadline}${extraActive ? " (열림)" : ""}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <JigeunCapSettings
            caps={caps}
            freezeDate={freezeDate}
            weekendHolidayTurns={weekendHolidayTurns}
            jigeunTurns={jigeunTurns}
            holidayTurnRules={holidayTurnRules}
            officeName={officeName}
            extraDeadline={extraDeadline}
            extraYear={extraYear}
            extraQuarter={extraQuarter}
            onSaved={() => requestsRefreshRef.current()}
          />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={logout}
            title="로그아웃"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <aside className="w-12 sm:w-48 shrink-0 border-r p-2 flex flex-col gap-1 overflow-y-auto">
          <p className="hidden sm:block px-3 pt-1 pb-2 text-xs font-semibold text-muted-foreground">
            대시보드
          </p>
          <SidebarItem
            icon={ClipboardList}
            label="신청현황"
            active={page === "requests"}
            onClick={() => setPage("requests")}
          />
          <SidebarItem
            icon={Megaphone}
            label="공지"
            active={page === "announce"}
            onClick={() => setPage("announce")}
          />
          <SidebarItem
            icon={FileText}
            label="문서"
            active={page === "document"}
            onClick={() => setPage("document")}
          />
          <SidebarItem
            icon={KeyRound}
            label="PIN 초기화"
            active={page === "pin"}
            onClick={() => setPage("pin")}
          />
          <SidebarItem
            icon={CalendarCog}
            label="직원근무 수정"
            active={page === "reference"}
            onClick={() => setPage("reference")}
          />
          <SidebarItem
            icon={Users}
            label="직원명단 관리"
            onClick={() => window.open(STAFF_EDIT_URL, "_blank", "noopener")}
          />
          <SidebarItem
            icon={Repeat}
            label="교번관리"
            active={page === "patterns"}
            onClick={() => setPage("patterns")}
          />
        </aside>

        <main className="flex flex-1 flex-col min-w-0">
          {page === "requests" && (
            <RequestsPanel
              onSettingsLoaded={(s) => {
                setCaps(s.caps);
                setFreezeDate(s.freezeDate);
                setWeekendHolidayTurns(s.weekendHolidayTurns);
                setJigeunTurns(s.jigeunTurns);
                setHolidayTurnRules(s.holidayTurnRules);
                setOfficeName(s.officeName);
                setExtraDeadline(s.extraRequestDeadline);
                setExtraYear(s.extraRequestYear);
                setExtraQuarter(s.extraRequestQuarter);
              }}
              registerRefresh={(fn) => {
                requestsRefreshRef.current = fn;
              }}
            />
          )}
          {page === "announce" && (
            <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
              <div>
                <h2 className="text-base font-bold">공지사항 관리</h2>
                <p className="text-sm text-muted-foreground">
                  직원 캘린더 하단에 표시되는 공지를 작성·수정·삭제합니다.
                </p>
              </div>
              <AnnouncementAdminContent />
            </div>
          )}
          {page === "document" && (
            <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
              <div>
                <h2 className="text-base font-bold">문서 관리</h2>
                <p className="text-sm text-muted-foreground">
                  직원에게 배포할 문서를 등록하고, 열람 확인·투표 현황을
                  조회합니다.
                </p>
              </div>
              <DocumentAdminContent />
            </div>
          )}
          {page === "pin" && <PinResetPanel />}
          {page === "reference" && <ReferenceEditPanel />}
          {page === "patterns" && <WorkPatternPanel />}
        </main>
      </div>
    </div>
  );
}

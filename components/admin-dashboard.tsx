"use client";

import { useState, useRef, type ComponentType } from "react";
import { useAuth } from "@/lib/auth-context";
import type {
  JigeunCaps,
  HolidayTurnRule,
  JigeunTurnSettings,
  ExcelFillColors,
} from "@/lib/types";
import {
  DEFAULT_JIGEUN_CAPS,
  DEFAULT_WEEKEND_HOLIDAY_TURNS,
  DEFAULT_JIGEUN_TURNS,
  DEFAULT_HOLIDAY_TURN_RULES,
  DEFAULT_EXCEL_FILL_COLORS,
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
import { AutoLotteryStatus } from "@/components/auto-lottery-status";
import { RequestsPanel } from "@/components/admin-panels/requests-panel";
import { PinResetPanel } from "@/components/admin-panels/pin-reset-panel";
import { LotteryLosersPanel } from "@/components/admin-panels/lottery-losers-panel";
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
  PhoneCall,
  GraduationCap,
} from "lucide-react";

type AdminPage =
  | "requests"
  | "losers"
  | "announce"
  | "document"
  | "training"
  | "pin"
  | "reference"
  | "patterns";

const pageDetails: Record<AdminPage, { title: string; description: string }> = {
  requests: { title: "신청현황", description: "월별 지근·지휴 신청 관리" },
  losers: { title: "추첨 탈락자", description: "탈락 내역과 연락 대상 확인" },
  announce: { title: "공지", description: "직원 캘린더 공지 관리" },
  document: { title: "문서", description: "배포 문서와 열람 현황" },
  training: { title: "교육훈련", description: "교육 자료와 확인 현황" },
  pin: { title: "PIN 초기화", description: "직원 로그인 지원" },
  reference: { title: "직원근무 수정", description: "기준일·기준 근무번호 수정" },
  patterns: { title: "교번관리", description: "근무 패턴 설정" },
};

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
        "flex w-full shrink-0 items-center gap-3 rounded-md px-3 py-3 text-sm text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:w-auto",
        active
          ? "bg-primary/10 text-primary font-semibold ring-1 ring-primary/15"
          : "hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon
        className={cn(
          "h-4 w-4 shrink-0",
          active ? "text-primary" : "text-muted-foreground"
        )}
      />
      <span className="whitespace-nowrap">{label}</span>
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
  const [excelColors, setExcelColors] = useState<ExcelFillColors>(
    DEFAULT_EXCEL_FILL_COLORS
  );
  const [officeName, setOfficeName] = useState<string>(DEFAULT_OFFICE_NAME);
  const [extraDeadline, setExtraDeadline] = useState<string | null>(null);
  const [extraYear, setExtraYear] = useState<number | null>(null);
  const [extraQuarter, setExtraQuarter] = useState<number | null>(null);
  const [autoLotteryEnabled, setAutoLotteryEnabled] = useState(false);
  const [autoLotteryDoneFor, setAutoLotteryDoneFor] = useState<string | null>(
    null
  );
  // RequestsPanel 의 재조회 함수 — JigeunCapSettings 저장 후 호출
  const requestsRefreshRef = useRef<() => void>(() => {});

  const today = format(new Date(), "yyyy-MM-dd");
  // 추가 신청 기간은 1차 마감 다음날부터 추가 신청일까지다.
  const extraActive =
    !!extraDeadline && !!freezeDate && today > freezeDate && today <= extraDeadline;

  return (
    <div className="flex flex-col min-h-dvh bg-secondary/40">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-2 border-l-[3px] border-primary pl-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">ADMIN WORKSPACE</p>
            <h1 className="text-lg font-bold leading-tight">근무 운영 관리</h1>
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
            excelColors={excelColors}
            officeName={officeName}
            extraDeadline={extraDeadline}
            extraYear={extraYear}
            extraQuarter={extraQuarter}
            autoLotteryEnabled={autoLotteryEnabled}
            onSaved={() => requestsRefreshRef.current()}
          />
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={logout}
            title="로그아웃"
            aria-label="로그아웃"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* 추첨은 DB 예약 작업이 실행한다. 대시보드는 완료 기록만 표시한다. */}
      <AutoLotteryStatus
        enabled={autoLotteryEnabled}
        freezeDate={freezeDate}
        doneFor={autoLotteryDoneFor}
        targetYear={extraYear}
        targetQuarter={extraQuarter}
      />

      <div className="flex flex-1 min-h-0 flex-col md:flex-row">
        <nav aria-label="관리 메뉴" className="flex w-full shrink-0 gap-1 overflow-x-auto border-b bg-background p-2 md:w-56 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:px-3 md:py-5">
          <p className="hidden px-3 pb-2 text-[11px] font-bold tracking-widest text-muted-foreground md:block">신청 및 일정</p>
          <SidebarItem
            icon={ClipboardList}
            label="신청현황"
            active={page === "requests"}
            onClick={() => setPage("requests")}
          />
          <SidebarItem
            icon={PhoneCall}
            label="추첨 탈락자"
            active={page === "losers"}
            onClick={() => setPage("losers")}
          />
          <p className="hidden px-3 pb-2 pt-5 text-[11px] font-bold tracking-widest text-muted-foreground md:block">게시 및 배포</p>
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
            icon={GraduationCap}
            label="교육훈련"
            active={page === "training"}
            onClick={() => setPage("training")}
          />
          <p className="hidden px-3 pb-2 pt-5 text-[11px] font-bold tracking-widest text-muted-foreground md:block">직원 및 설정</p>
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
        </nav>

        <main className="admin-workspace flex flex-1 flex-col min-w-0 bg-background md:m-5 md:rounded-lg md:border">
          {page !== "requests" && (
            <div className="border-b bg-secondary/35 px-4 py-5 sm:px-6">
              <p className="text-xs font-semibold tracking-wide text-primary">ADMIN / {pageDetails[page].title}</p>
              <h2 className="mt-1 text-xl font-bold">{pageDetails[page].title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{pageDetails[page].description}</p>
            </div>
          )}
          {page === "requests" && (
            <RequestsPanel
              onSettingsLoaded={(s) => {
                setCaps(s.caps);
                setFreezeDate(s.freezeDate);
                setWeekendHolidayTurns(s.weekendHolidayTurns);
                setJigeunTurns(s.jigeunTurns);
                setHolidayTurnRules(s.holidayTurnRules);
                setExcelColors(s.excelColors);
                setOfficeName(s.officeName);
                setExtraDeadline(s.extraRequestDeadline);
                setExtraYear(s.extraRequestYear);
                setExtraQuarter(s.extraRequestQuarter);
                setAutoLotteryEnabled(s.autoLotteryEnabled);
                setAutoLotteryDoneFor(s.autoLotteryDoneFor);
              }}
              registerRefresh={(fn) => {
                requestsRefreshRef.current = fn;
              }}
            />
          )}
          {page === "losers" && <LotteryLosersPanel />}
          {page === "announce" && (
            <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
              <div>
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
                <p className="text-sm text-muted-foreground">
                  직원에게 배포할 문서를 등록하고, 열람 확인·투표 현황을
                  조회합니다.
                </p>
              </div>
              <DocumentAdminContent category="document" />
            </div>
          )}
          {page === "training" && (
            <div className="flex flex-1 flex-col min-w-0 gap-3 p-4 overflow-auto">
              <div>
                <p className="text-sm text-muted-foreground">
                  교육 자료를 등록하면 직원이 열람 후 확인 버튼으로 서명합니다.
                  확인 현황에서 미확인자에게 휴가·병가·휴직 사유를 지정하고
                  엑셀로 내려받을 수 있습니다.
                </p>
              </div>
              <DocumentAdminContent category="training" />
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

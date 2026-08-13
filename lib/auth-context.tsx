"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Employee } from "@/lib/types";
import { supabase } from "@/lib/supabase";

const STORAGE_KEY = "dongseung_employee";

interface AuthContextValue {
  employee: Employee | null;
  isReady: boolean;
  isAdmin: boolean;
  login: (employee: Employee) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isReady, setIsReady] = useState(false);

  // localStorage 는 클라이언트에서만 접근 가능. 마운트 후 1회 복원.
  //
  // 복원한 세션은 DB 와 한 번 대조한다. 저장값은 로그인 시점의 복사본이라,
  // 그 사이 직원이 명단에서 삭제돼도 그대로 로그인 상태가 유지된다.
  // 실제로 그렇게 남은 세션이 없는 staff_id 로 지근을 신청해 관리자 화면에
  // '(미상 284)' 로 보이는 사고가 있었다. 이름·직책 변경도 반영되지 않는다.
  //
  // 주의: 조회에 실패했을 때(오프라인·일시적 네트워크 오류)는 로그아웃시키지
  // 않는다. '행이 없음' 이 확인된 경우에만 세션을 지운다 — 지하철 환경 특성상
  // 통신이 불안정해서, 실패를 삭제로 오인하면 멀쩡한 사용자가 튕겨나간다.
  useEffect(() => {
    let restored: Employee | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) restored = JSON.parse(raw) as Employee;
    } catch {
      // 손상된 저장값은 무시
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    if (restored) setEmployee(restored);
    setIsReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */

    if (!restored) return;
    const staffId = restored.staff_id;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("coworker_list")
        .select("staff_id, staff_name, staff_position, employee_number, role")
        .eq("staff_id", staffId)
        .maybeSingle();

      // 조회 자체가 실패하면 판단을 보류한다(로그인 상태 유지).
      if (cancelled || error) return;

      if (!data) {
        // 명단에서 삭제된 계정 — 세션을 지운다.
        setEmployee(null);
        localStorage.removeItem(STORAGE_KEY);
        return;
      }

      // 이름·직책·권한이 바뀌었으면 최신값으로 갱신한다.
      setEmployee((prev) => {
        if (!prev || prev.staff_id !== staffId) return prev;
        if (
          prev.staff_name === data.staff_name &&
          prev.staff_position === data.staff_position &&
          prev.employee_number === data.employee_number &&
          prev.role === data.role
        ) {
          return prev;
        }
        const next: Employee = {
          ...prev,
          staff_name: data.staff_name,
          staff_position: data.staff_position,
          employee_number: data.employee_number,
          role: data.role,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((next: Employee) => {
    setEmployee(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const logout = useCallback(() => {
    setEmployee(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        employee,
        isReady,
        isAdmin: employee?.role === "admin",
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

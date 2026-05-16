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

"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { hashPin, isValidPinFormat } from "@/lib/pin";
import type { Employee } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, ArrowLeft, ArrowRight, CalendarDays, ShieldCheck } from "lucide-react";

// 이름+사번 확인 후, PIN 미등록이면 "register", 등록돼 있으면 "verify".
type Step = "credentials" | "register" | "verify";

export function LoginForm() {
  const { login } = useAuth();
  const [step, setStep] = useState<Step>("credentials");
  const [name, setName] = useState("");
  const [empNumber, setEmpNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // credentials 단계에서 조회한 직원과 기존 pin_hash 를 보관.
  const [pendingEmployee, setPendingEmployee] = useState<Employee | null>(null);
  const [storedPinHash, setStoredPinHash] = useState<string | null>(null);

  // PIN 입력 상태
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");

  const resetToCredentials = () => {
    setStep("credentials");
    setPendingEmployee(null);
    setStoredPinHash(null);
    setPin("");
    setPinConfirm("");
    setError(null);
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmp = empNumber.trim();
    if (!trimmedName || !trimmedEmp) {
      setError("이름과 사번을 모두 입력해주세요.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from("coworker_list")
        .select(
          "staff_id, staff_name, staff_position, employee_number, phone_number, role, pin_hash, reference_date, reference_shift, device_id"
        )
        .eq("staff_name", trimmedName)
        .eq("employee_number", trimmedEmp)
        .maybeSingle();

      if (queryError) throw queryError;
      if (!data) {
        setError("이름 또는 사번이 일치하지 않습니다.");
        return;
      }

      const { pin_hash, ...employee } = data as Employee & {
        pin_hash: string | null;
      };
      setPendingEmployee(employee);
      setStoredPinHash(pin_hash);
      setPin("");
      setPinConfirm("");
      // pin_hash 가 없으면 최초 등록, 있으면 검증 단계로.
      setStep(pin_hash ? "verify" : "register");
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEmployee) return;
    if (!isValidPinFormat(pin)) {
      setError("PIN 은 숫자 4~6자리로 설정해주세요.");
      return;
    }
    if (pin !== pinConfirm) {
      setError("PIN 이 일치하지 않습니다. 다시 입력해주세요.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const newHash = await hashPin(pendingEmployee.staff_id, pin);
      const { error: upErr } = await supabase
        .from("coworker_list")
        .update({ pin_hash: newHash })
        .eq("staff_id", pendingEmployee.staff_id);
      if (upErr) throw upErr;
      login(pendingEmployee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PIN 등록에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingEmployee || !storedPinHash) return;
    if (!isValidPinFormat(pin)) {
      setError("PIN 은 숫자 4~6자리입니다.");
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const inputHash = await hashPin(pendingEmployee.staff_id, pin);
      if (inputHash !== storedPinHash) {
        setError("PIN 이 일치하지 않습니다.");
        return;
      }
      login(pendingEmployee);
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-dvh bg-secondary/70">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 sm:px-8">
        <header className="flex items-center justify-between border-b border-border py-5">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground" aria-hidden="true"><CalendarDays className="size-5" /></span>
            <span className="text-sm font-bold tracking-tight">지근 · 지휴 관리</span>
          </div>
          <ThemeToggle />
        </header>
        <div className="grid flex-1 items-center gap-7 py-8 md:grid-cols-[minmax(0,1fr)_minmax(360px,420px)] md:gap-20 md:py-20">
          <section className="max-w-xl">
            <p className="mb-3 text-xs font-bold tracking-[0.16em] text-primary md:mb-5">WORK SCHEDULE / ACCESS</p>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl">근무 일정과 신청 현황을<br />한곳에서 확인하세요.</h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted-foreground md:mt-6 md:text-base md:leading-7">내 근무 달력을 확인하고 지근·지휴를 신청할 수 있습니다. 관리자라면 신청 현황과 마감 설정을 한 화면에서 관리하세요.</p>
            <div className="mt-5 flex items-start gap-3 border-t pt-4 text-xs text-muted-foreground md:mt-10 md:pt-5 md:text-sm">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <p>최종 지근·지휴 확정은 담당부장(관리자)이 진행합니다.</p>
            </div>
          </section>
          <section className="w-full rounded-xl border border-border bg-card p-5 shadow-sm sm:p-8" aria-labelledby="login-heading">
            <p className="text-xs font-semibold text-primary">계정 확인</p>
            <h2 id="login-heading" className="mt-2 text-2xl font-bold">{step === "credentials" ? "로그인" : step === "register" ? "PIN 등록" : "PIN 확인"}</h2>
            <p className="mb-7 mt-2 text-sm text-muted-foreground">{step === "credentials" ? "등록된 이름과 사번을 입력해 주세요." : "본인 확인을 마치고 계속 진행하세요."}</p>

        {step === "credentials" && (
          <form onSubmit={handleCredentials} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-name" className="text-sm font-medium">이름</label>
              <Input id="login-name" type="text" placeholder="이름을 입력하세요" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </div>
            <div className="space-y-2">
              <label htmlFor="login-number" className="text-sm font-medium">사번</label>
              <Input id="login-number" type="text" inputMode="numeric" placeholder="사번을 입력하세요" value={empNumber} onChange={(e) => setEmpNumber(e.target.value)} autoComplete="off" required />
            </div>
            {error && <p role="alert" className="text-destructive text-sm font-medium">{error}</p>}
            <Button type="submit" className="h-11 w-full justify-between rounded-md" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>다음 <ArrowRight className="size-4" /></>}
            </Button>
          </form>
        )}

        {step === "register" && (
          <form onSubmit={handleRegister} className="space-y-3">
            <p className="text-sm font-medium text-center">
              <span className="font-bold">{pendingEmployee?.staff_name}</span>님,
              처음 로그인입니다.
            </p>
            <p className="text-muted-foreground text-sm text-center">
              본인만 아는 PIN(숫자 4~6자리)을 설정해주세요. 다음부터는 이
              PIN 으로 로그인합니다.
            </p>
            <Input
              aria-label="새 PIN"
              type="password"
              inputMode="numeric"
              placeholder="PIN 입력 (숫자 4~6자리)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="new-password"
              maxLength={6}
            />
            <Input
              aria-label="새 PIN 확인"
              type="password"
              inputMode="numeric"
              placeholder="PIN 다시 입력"
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value)}
              autoComplete="new-password"
              maxLength={6}
            />
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "PIN 설정 후 로그인"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={resetToCredentials}
              disabled={isLoading}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              이전으로
            </Button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={handleVerify} className="space-y-3">
            <p className="text-sm font-medium text-center">
              <span className="font-bold">{pendingEmployee?.staff_name}</span>님,
              PIN 을 입력해주세요.
            </p>
            <Input
              aria-label="PIN"
              type="password"
              inputMode="numeric"
              placeholder="PIN (숫자 4~6자리)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="off"
              maxLength={6}
              autoFocus
            />
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "로그인"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={resetToCredentials}
              disabled={isLoading}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              이전으로
            </Button>
            <p className="text-muted-foreground text-xs text-center">
              PIN 을 잊으셨다면 관리자(담당부장)에게 초기화를 요청하세요.
            </p>
          </form>
        )}

          </section>
        </div>
        <footer className="border-t py-5 text-xs text-muted-foreground">근무 순서 관리 시스템</footer>
      </div>
    </main>
  );
}

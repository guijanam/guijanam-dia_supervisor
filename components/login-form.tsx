"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { hashPin, isValidPinFormat } from "@/lib/pin";
import type { Employee } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, Phone, MessageSquare, ArrowLeft } from "lucide-react";

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
          "staff_id, staff_name, staff_position, employee_number, phone_number, role, pin_hash"
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
    <div className="flex items-center justify-center min-h-dvh px-6">
      <div className="w-full max-w-xs space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">지근/지휴 관리시스템</h1>
          <ThemeToggle />
        </div>

        {step === "credentials" && (
          <form onSubmit={handleCredentials} className="space-y-3">
            <p className="text-sm font-medium text-center">
              최종 지근/지휴 확정은 담당부장(관리자) 입니다.
            </p>
            <Input
              type="text"
              placeholder="이름"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
            <Input
              type="text"
              inputMode="numeric"
              placeholder="사번"
              value={empNumber}
              onChange={(e) => setEmpNumber(e.target.value)}
              autoComplete="off"
            />
            {error && (
              <p className="text-destructive text-sm font-medium">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "다음"
              )}
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
              type="password"
              inputMode="numeric"
              placeholder="PIN 입력 (숫자 4~6자리)"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="new-password"
              maxLength={6}
            />
            <Input
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

        <div className="mt-6 space-y-3 text-center">
          <p className="text-muted-foreground text-sm">
            사번과 근무순서가 틀리면 언제든지 연락주세요.
          </p>
          <p className="text-muted-foreground text-xs">
            시스템개발자 -손희범-
          </p>
          <div className="flex flex-col gap-2">
            <Button asChild variant="outline" className="w-full">
              <a href="tel:01084176637">
                <Phone className="mr-2 h-4 w-4" />
                개발자에게 전화하기
              </a>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <a href="sms:01084176637">
                <MessageSquare className="mr-2 h-4 w-4" />
                개발자에게 문자하기
              </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

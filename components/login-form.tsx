"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { Employee } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Loader2, Phone, MessageSquare } from "lucide-react";

export function LoginForm() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [empNumber, setEmpNumber] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
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
          "staff_id, staff_name, staff_position, employee_number, phone_number, role"
        )
        .eq("staff_name", trimmedName)
        .eq("employee_number", trimmedEmp)
        .maybeSingle();

      if (queryError) throw queryError;
      if (!data) {
        setError("이름 또는 사번이 일치하지 않습니다.");
        return;
      }

      login(data as Employee);
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
        <form onSubmit={handleSubmit} className="space-y-3">
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
              "로그인"
            )}
          </Button>
        </form>

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

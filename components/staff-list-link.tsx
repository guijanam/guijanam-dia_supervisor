"use client";

import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const STAFF_EDIT_URL = "https://coworker-edit.vercel.app/admin/login";

export function StaffListLink() {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => window.open(STAFF_EDIT_URL, "_blank", "noopener")}
      className="shrink-0"
      title="직원명단 관리"
    >
      <Users className="h-4 w-4" />
      직원명단
    </Button>
  );
}

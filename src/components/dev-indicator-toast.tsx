"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export function DevIndicatorToast() {
  useEffect(() => {
    toast.info("Development mode", { duration: 3000 });
  }, []);

  return null;
}

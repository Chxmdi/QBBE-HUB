"use client";

import { useEffect } from "react";

export function PersonDeepLink({ personId }: { personId: string | null }) {
  useEffect(() => {
    if (!personId) return;
    document.getElementById(`person-${personId}`)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [personId]);
  return null;
}

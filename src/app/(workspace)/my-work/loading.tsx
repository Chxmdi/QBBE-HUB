"use client";

import { TableSkeleton } from "@/components/ui/skeleton";
import { useT } from "@/lib/i18n/client";

export default function Loading() {
  const t = useT();
  return <TableSkeleton label={t("myWork.loading")} />;
}

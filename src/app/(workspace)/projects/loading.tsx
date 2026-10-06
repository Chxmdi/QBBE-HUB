import { TableSkeleton } from "@/components/ui/skeleton";
import { getT } from "@/lib/i18n/server";

export default async function Loading() {
  const t = await getT();
  return <TableSkeleton label={t("projects.loadingList")} />;
}

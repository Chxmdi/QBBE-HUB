import { DetailSkeleton } from "@/components/ui/skeleton";
import { getT } from "@/lib/i18n/server";

export default async function Loading() {
  const t = await getT();
  return <DetailSkeleton label={t("crm.loading")} />;
}

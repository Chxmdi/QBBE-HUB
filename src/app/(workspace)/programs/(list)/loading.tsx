import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/lib/i18n/server";

/**
 * Shown while the programs and their projects load. Without it the screen
 * stayed blank for about two seconds on in-app navigation (staging audit M13).
 * Shaped like the page: a header, then a grid of program cards. It sits in the
 * (list) group so it covers only the list, not each program's own page.
 */
export default async function Loading() {
  const t = await getT();
  return (
    <div role="status" aria-label={t("programs.loadingList")}>
      <Skeleton className="mb-2 h-3 w-24" />
      <Skeleton className="mb-3 h-8 w-48" />
      <Skeleton className="mb-8 h-4 w-80 max-w-full" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card space-y-3 p-5">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

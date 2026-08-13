import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceLoading() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-9 w-72" />
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <ListSkeleton rows={6} />
    </div>
  );
}

import { ListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-5xl">
      <Skeleton className="mb-2 h-4 w-24" />
      <Skeleton className="mb-6 h-9 w-72" />
      <ListSkeleton rows={4} />
      <div className="mt-8">
        <ListSkeleton rows={4} />
      </div>
    </div>
  );
}

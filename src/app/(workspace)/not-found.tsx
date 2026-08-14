import Link from "next/link";
import { SearchX } from "lucide-react";

export default function WorkspaceNotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <SearchX className="size-8 text-muted" aria-hidden />
      <h1 className="text-[18px] font-semibold">
        Not found — or not yours to see
      </h1>
      <p className="max-w-md text-[13.5px] text-muted">
        This record doesn&apos;t exist, was archived, or your access doesn&apos;t
        include it. Deep links always re-check authorization.
      </p>
      <Link href="/" className="mt-2 text-[13.5px] font-medium text-brand-fg hover:underline">
        Back to Home
      </Link>
    </div>
  );
}

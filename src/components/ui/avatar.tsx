import * as React from "react";
import { cn, initials } from "@/lib/utils";

const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-6.5 text-[10.5px]",
  md: "size-8 text-[12px]",
  lg: "size-12 text-[16px]",
} as const;

/** Deterministic warm background per name so avatars are stable. */
function colorFor(name: string): string {
  const palette = [
    "bg-brand text-white",
    "bg-avatar-1 text-white",
    "bg-avatar-2 text-white",
    "bg-avatar-3 text-white",
    "bg-avatar-4 text-white",
    "bg-avatar-5 text-white",
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return palette[hash % palette.length];
}

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof sizes;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name}
        className={cn(
          "shrink-0 rounded-full object-cover",
          sizes[size],
          className,
        )}
      />
    );
  }
  return (
    // The <img> branch above names itself through alt, so a silent fallback
    // meant "assigned to Dara" read as "assigned to" for anyone without a
    // photo. Both branches expose the same name.
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizes[size],
        colorFor(name),
        className,
      )}
    >
      {initials(name || "?")}
    </span>
  );
}

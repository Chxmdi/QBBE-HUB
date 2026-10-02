"use client";

import * as React from "react";

/** One entry in a column header's menu. */
export interface ColumnMenuItem {
  label: string;
  run: () => void;
}

/** The menu a column header opens (Enter, F2 or the chevron): arrow keys move, Escape or Tab close. */
export function ColumnMenu({
  label,
  items,
  onClose,
}: {
  label: string;
  items: { label: string; run: () => void }[];
  onClose: () => void;
}) {
  const [active, setActive] = React.useState(0);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  React.useEffect(() => {
    refs.current[active]?.focus();
  }, [active]);
  return (
    <div
      role="menu"
      aria-label={label}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || e.key === "Tab") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => (a + 1) % items.length);
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => (a - 1 + items.length) % items.length);
        } else if (e.key === "Home") {
          e.preventDefault();
          setActive(0);
        } else if (e.key === "End") {
          e.preventDefault();
          setActive(items.length - 1);
        }
      }}
      className="absolute left-0 top-full z-(--z-overlay) mt-1 min-w-48 rounded-(--radius-md) border border-line bg-surface py-1 font-normal text-ink shadow-lg"
    >
      {items.map((item, i) => (
        <button
          key={item.label}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={i === active ? 0 : -1}
          onClick={() => {
            item.run();
            onClose();
          }}
          className="block w-full px-3 py-1.5 text-left text-[13.5px] hover:bg-surface-soft focus:bg-surface-soft focus:outline-none"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

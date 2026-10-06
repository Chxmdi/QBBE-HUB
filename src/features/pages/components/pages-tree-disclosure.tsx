"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePagesT } from "@/features/pages/i18n/client";
import { cn } from "@/lib/utils";

/**
 * The page tree while a page is open, below desktop width.
 *
 * The tree stacked above the page in one column, so on a phone every page
 * opened onto the whole list — favourites, recent and every workspace page —
 * and its own content started screens further down. It now folds behind one
 * button there; at desktop width it is the left column, always shown.
 */
export function PagesTreeDisclosure({ children }: { children: React.ReactNode }) {
  const t = usePagesT();
  const [open, setOpen] = React.useState(false);
  const id = React.useId();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="lg:hidden"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((value) => !value)}
      >
        {t("sidebar.allPages")}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </Button>
      <div id={id} className={open ? "mt-3" : "hidden lg:block"}>
        {children}
      </div>
    </>
  );
}

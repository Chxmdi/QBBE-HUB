"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/client";
import { intlLocale } from "@/lib/i18n/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { queryErrorFrom } from "@/lib/query/errors";
import { useLensT } from "@/features/lenses/i18n/client";
import {
  DAY_WIDTH,
  ROW_HEIGHT,
  addDays,
  arrowPath,
  dayX,
  daysBetween,
  planShift,
  timelineRange,
  type Edge,
  type Move,
  type TimelineBar,
} from "./model";

interface Pending {
  id: string;
  deltaStart: number;
  deltaEnd: number;
}

interface Confirm {
  title: string;
  primary: Move;
  dependents: Move[];
  locked: string[];
}

const TITLE_WIDTH = 240;

/**
 * The timeline lens (V1-2). Each task is a bar from its start to its due
 * date; arrows join a task to the tasks waiting on it. A bar moves by drag
 * or by keyboard (arrows, Shift+arrows to resize, Enter to save). When a move
 * would make dependent tasks start too early, the person is asked whether to
 * move them too; the moves then land together or not at all
 * (public.lens_shift_tasks).
 */
export function TimelineLens({ bars, edges, today }: { bars: TimelineBar[]; edges: Edge[]; today: string }) {
  const t = useLensT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [confirm, setConfirm] = React.useState<Confirm | null>(null);
  const [announcement, setAnnouncement] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const dragRef = React.useRef<{ id: string; x: number; mode: "move" | "end"; moved: boolean } | null>(null);

  const range = React.useMemo(() => timelineRange(bars, today), [bars, today]);
  const rowOf = React.useMemo(() => new Map(bars.map((b, i) => [b.id, i])), [bars]);
  const byId = React.useMemo(() => new Map(bars.map((b) => [b.id, b])), [bars]);
  const dayFormat = React.useMemo(
    () => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", timeZone: "UTC" }),
    [locale],
  );
  const fmt = (day: string) => dayFormat.format(new Date(`${day}T12:00:00Z`));
  const width = range.days * DAY_WIDTH;

  const shown = (b: TimelineBar): { start: string; end: string } => {
    if (!pending || pending.id !== b.id) return b;
    const start = addDays(b.start, pending.deltaStart);
    const end = addDays(b.end, pending.deltaEnd);
    return { start: start <= end ? start : end, end };
  };

  const labelFor = (b: TimelineBar) => {
    const { start, end } = shown(b);
    return start === end ? t("timeline.barOne", { title: b.title, date: fmt(start) }) : t("timeline.bar", { title: b.title, start: fmt(start), end: fmt(end) });
  };

  const save = async (moves: Move[]) => {
    setBusy(true);
    const { error } = await createSupabaseBrowserClient().rpc("lens_shift_tasks", { p_moves: moves });
    setBusy(false);
    setPending(null);
    setConfirm(null);
    if (error) {
      setAnnouncement(t("timeline.failed", { reason: queryErrorFrom(error).message }));
      return;
    }
    setAnnouncement(moves.length === 1 ? t("timeline.movedOne", { title: byId.get(moves[0].id)?.title ?? "" }) : t("timeline.moved", { count: moves.length }));
    router.refresh();
  };

  const commit = (p: Pending) => {
    if (p.deltaStart === 0 && p.deltaEnd === 0) {
      setPending(null);
      return;
    }
    const plan = planShift(bars, edges, p.id, p.deltaStart, p.deltaEnd);
    if (!plan.primary) return;
    if (plan.dependents.length || plan.blockedBy.length) {
      setConfirm({ title: byId.get(p.id)!.title, primary: plan.primary, dependents: plan.dependents, locked: plan.blockedBy });
    } else {
      void save([plan.primary]);
    }
  };

  const onKeyDown = (b: TimelineBar) => (event: React.KeyboardEvent) => {
    if (!b.editable || busy) return;
    const current = pending?.id === b.id ? pending : { id: b.id, deltaStart: 0, deltaEnd: 0 };
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      const next = event.shiftKey
        ? { ...current, deltaEnd: current.deltaEnd + step }
        : { ...current, deltaStart: current.deltaStart + step, deltaEnd: current.deltaEnd + step };
      setPending(next);
      const start = addDays(b.start, next.deltaStart);
      const end = addDays(b.end, next.deltaEnd);
      setAnnouncement(t("timeline.pending", { title: b.title, start: fmt(start <= end ? start : end), end: fmt(end) }));
    } else if (event.key === "Enter" && pending?.id === b.id) {
      event.preventDefault();
      commit(pending);
    } else if (event.key === "Escape" && pending) {
      event.preventDefault();
      setPending(null);
    }
  };

  const onPointerDown = (b: TimelineBar, mode: "move" | "end") => (event: React.PointerEvent) => {
    if (!b.editable || busy) return;
    event.preventDefault();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    dragRef.current = { id: b.id, x: event.clientX, mode, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const days = Math.round((event.clientX - drag.x) / DAY_WIDTH);
    if (days !== 0) drag.moved = true;
    setPending(drag.mode === "move" ? { id: drag.id, deltaStart: days, deltaEnd: days } : { id: drag.id, deltaStart: 0, deltaEnd: days });
  };
  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && drag.moved && pending) commit(pending);
    else if (drag) setPending(null);
  };

  const months: { label: string; x: number }[] = [];
  for (let i = 0; i < range.days; i += 1) {
    const day = addDays(range.from, i);
    if (i === 0 || day.endsWith("-01")) {
      months.push({
        label: new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)),
        x: i * DAY_WIDTH,
      });
    }
  }

  const dependsOn = (id: string) =>
    edges.filter((e) => e.blocked === id && byId.has(e.blocking)).map((e) => byId.get(e.blocking)!.title);

  if (!bars.length) return <p className="card px-4 py-6 text-center text-[13px] text-muted">{t("timeline.empty")}</p>;

  return (
    <div>
      <p id="timeline-hint" className="mb-2 text-[12.5px] text-muted">
        {t("timeline.hint")}
      </p>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <div className="card overflow-x-auto" tabIndex={0} role="region" aria-label={t("timeline.title")}>
        <div className="flex" style={{ width: TITLE_WIDTH + width }}>
          {/* Titles */}
          <div className="sticky left-0 z-(--z-raised) shrink-0 border-r border-line bg-surface" style={{ width: TITLE_WIDTH }}>
            <div className="h-12 border-b border-line" aria-hidden />
            <ul aria-label={t("timeline.rowsLabel")}>
              {bars.map((b) => (
                <li key={b.id} className="flex items-center truncate px-3 text-[13px]" style={{ height: ROW_HEIGHT }}>
                  <Link href={`/my-work?task=${b.id}`} className={cn("truncate font-medium text-ink hover:text-brand-fg", b.done && "line-through opacity-70")}>
                    {b.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          {/* Chart */}
          <div className="relative" style={{ width }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            <div className="relative h-12 border-b border-line" aria-hidden>
              {months.map((m) => (
                <span key={m.x} className="absolute top-1 whitespace-nowrap pl-1 text-[11.5px] font-semibold capitalize text-ink" style={{ left: m.x }}>
                  {m.label}
                </span>
              ))}
              {Array.from({ length: range.days }).map((_, i) => {
                const day = addDays(range.from, i);
                return (
                  <span
                    key={day}
                    className={cn("absolute bottom-1 text-center text-[10px] text-muted", day === today && "font-bold text-brand-fg")}
                    style={{ left: i * DAY_WIDTH, width: DAY_WIDTH }}
                  >
                    {Number(day.slice(8))}
                  </span>
                );
              })}
            </div>
            <div className="relative" style={{ height: bars.length * ROW_HEIGHT }}>
              {/* Today */}
              <div className="absolute top-0 bottom-0 w-px bg-brand/50" style={{ left: dayX(range.from, today) + DAY_WIDTH / 2 }} aria-hidden />
              {/* Dependency arrows (the same information is on each bar as text) */}
              <svg className="pointer-events-none absolute inset-0 text-muted" width={width} height={bars.length * ROW_HEIGHT} aria-hidden>
                <defs>
                  <marker id="lens-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M0 0 L8 4 L0 8 z" fill="currentColor" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const from = byId.get(e.blocking);
                  const to = byId.get(e.blocked);
                  if (!from || !to) return null;
                  const f = { ...from, ...shown(from) };
                  const tt = { ...to, ...shown(to) };
                  return (
                    <path
                      key={`${e.blocking}-${e.blocked}`}
                      data-edge={`${e.blocking}->${e.blocked}`}
                      d={arrowPath(range.from, f, rowOf.get(from.id)!, tt, rowOf.get(to.id)!)}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      markerEnd="url(#lens-arrow)"
                    />
                  );
                })}
              </svg>
              {bars.map((b, i) => {
                const { start, end } = shown(b);
                const waits = dependsOn(b.id);
                const descId = `bar-desc-${b.id}`;
                const left = dayX(range.from, start);
                const barWidth = (daysBetween(start, end) + 1) * DAY_WIDTH;
                const isPending = pending?.id === b.id;
                const style = { left, top: i * ROW_HEIGHT + 8, width: barWidth, height: ROW_HEIGHT - 16 };
                const tone = b.done ? "bg-muted/35 text-ink" : "bg-brand text-white dark:text-canvas";
                return (
                  <React.Fragment key={b.id}>
                    <span id={descId} className="sr-only">
                      {[waits.length ? t("timeline.dependsOn", { names: waits.join(", ") }) : "", b.editable ? t("timeline.hint") : t("timeline.readOnly")].filter(Boolean).join(" ")}
                    </span>
                    {b.editable ? (
                      <button
                        type="button"
                        data-bar={b.id}
                        aria-label={labelFor(b)}
                        aria-describedby={descId}
                        onKeyDown={onKeyDown(b)}
                        onPointerDown={onPointerDown(b, "move")}
                        onBlur={() => {
                          if (pending?.id === b.id && !confirm) setPending(null);
                        }}
                        className={cn(
                          "absolute flex cursor-grab touch-none items-center overflow-hidden rounded-(--radius-sm) px-2 text-left text-[11.5px] font-medium",
                          tone,
                          isPending && "ring-2 ring-accent ring-offset-1",
                        )}
                        style={style}
                      >
                        <span className="truncate">{b.title}</span>
                        <span
                          aria-hidden
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            onPointerDown(b, "end")(e);
                          }}
                          className="absolute top-0 right-0 h-full w-2 cursor-ew-resize bg-white/30"
                        />
                      </button>
                    ) : (
                      <span
                        role="img"
                        data-bar={b.id}
                        aria-label={labelFor(b)}
                        aria-describedby={descId}
                        className={cn("absolute flex items-center overflow-hidden rounded-(--radius-sm) px-2 text-[11.5px] font-medium opacity-80", tone)}
                        style={style}
                      >
                        <span className="truncate" aria-hidden>
                          {b.title}
                        </span>
                      </span>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <Dialog open={confirm !== null} onClose={() => { setConfirm(null); setPending(null); }} title={t("timeline.confirmTitle")}>
        {confirm ? (
          <div className="space-y-3 text-[13.5px]">
            <p>{t("timeline.confirmBody", { title: confirm.title, start: fmt(confirm.primary.start), end: fmt(confirm.primary.due) })}</p>
            {confirm.dependents.length ? (
              <ul className="list-disc pl-5">
                {confirm.dependents.map((m) => (
                  <li key={m.id}>
                    {t("timeline.bar", { title: byId.get(m.id)?.title ?? "", start: fmt(m.start), end: fmt(m.due) })}
                  </li>
                ))}
              </ul>
            ) : null}
            {confirm.locked.length ? (
              <p className="text-warning-fg">{t("timeline.confirmLocked", { names: confirm.locked.map((id) => byId.get(id)?.title ?? "").join(", ") })}</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => { setConfirm(null); setPending(null); }}>
                {t("timeline.cancel")}
              </Button>
              <Button type="button" variant="secondary" loading={busy} onClick={() => void save([confirm.primary])}>
                {t("timeline.moveOne")}
              </Button>
              {confirm.dependents.length ? (
                <Button type="button" loading={busy} onClick={() => void save([confirm.primary, ...confirm.dependents])}>
                  {t("timeline.moveAll", { count: confirm.dependents.length + 1 })}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

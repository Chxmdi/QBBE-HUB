"use client";

import * as React from "react";
import { GripVertical, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import {
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  CARD_HEIGHT,
  CARD_WIDTH,
  relationLine,
} from "../editor-state";
import { fill, pick, type BlueprintsMessages } from "../i18n";
import type { Blueprint } from "../schema";

const STEP = 20;

/**
 * The drawing surface. Cards can be dragged with a pointer or moved with the
 * arrow keys on their handle; "Connect" on one card then another draws a
 * relation. It is a convenience over the list editor below it, which does
 * everything the canvas does, so nothing here is the only way to do anything.
 */
export function BlueprintCanvas({
  blueprint,
  messages,
  locale,
  readOnly,
  onMove,
  onConnect,
  onAddType,
}: {
  blueprint: Blueprint;
  messages: BlueprintsMessages;
  locale: Locale;
  readOnly: boolean;
  onMove: (typeKey: string, x: number, y: number) => void;
  onConnect: (from: string, to: string) => void;
  onAddType: () => void;
}) {
  const [connectFrom, setConnectFrom] = React.useState<string | null>(null);
  const drag = React.useRef<{ key: string; dx: number; dy: number; pointer: number } | null>(null);
  const surface = React.useRef<HTMLDivElement>(null);
  const fromType = blueprint.types.find((t) => t.key === connectFrom);

  React.useEffect(() => {
    if (!connectFrom) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConnectFrom(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [connectFrom]);

  function connect(key: string) {
    if (!connectFrom) return setConnectFrom(key);
    if (connectFrom !== key) onConnect(connectFrom, key);
    setConnectFrom(null);
  }

  function onPointerDown(event: React.PointerEvent, key: string) {
    if (readOnly || !surface.current) return;
    const type = blueprint.types.find((t) => t.key === key);
    const box = surface.current.getBoundingClientRect();
    drag.current = {
      key,
      dx: event.clientX - box.left - (type?.layout?.x ?? 0),
      dy: event.clientY - box.top - (type?.layout?.y ?? 0),
      pointer: event.pointerId,
    };
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId || !surface.current) return;
    const box = surface.current.getBoundingClientRect();
    onMove(current.key, event.clientX - box.left - current.dx, event.clientY - box.top - current.dy);
  }

  function onHandleKey(event: React.KeyboardEvent, key: string, x: number, y: number) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-STEP, 0],
      ArrowRight: [STEP, 0],
      ArrowUp: [0, -STEP],
      ArrowDown: [0, STEP],
    };
    const move = moves[event.key];
    if (!move || readOnly) return;
    event.preventDefault();
    onMove(key, x + move[0], y + move[1]);
  }

  return (
    <section aria-labelledby="blueprint-canvas-heading" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="blueprint-canvas-heading" className="text-[15px] font-semibold text-ink">
            {messages.canvas.heading}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted">{messages.canvas.hint}</p>
        </div>
        {readOnly ? null : (
          <Button type="button" variant="secondary" size="sm" onClick={onAddType}>
            <Plus className="size-4" aria-hidden />
            {messages.canvas.addType}
          </Button>
        )}
      </div>

      <p aria-live="polite" className="min-h-5 text-[13px] text-brand-fg">
        {fromType ? fill(messages.canvas.connectFrom, { name: pick(fromType.name, locale) }) : ""}
      </p>

      <div className="overflow-auto rounded-(--radius-md) border border-line bg-canvas">
        <div
          ref={surface}
          role="group"
          aria-label={fill(messages.canvas.label, {
            types: blueprint.types.length,
            relations: blueprint.relations.length,
          })}
          className="relative"
          style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT }}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0"
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          >
            {blueprint.relations.map((relation) => {
              const line = relationLine(blueprint, relation);
              if (!line) return null;
              return (
                <g key={relation.key}>
                  <line {...line} className="stroke-brand-light" strokeWidth={2} />
                  <text
                    x={(line.x1 + line.x2) / 2}
                    y={(line.y1 + line.y2) / 2 - 6}
                    textAnchor="middle"
                    className="fill-muted text-[11px]"
                  >
                    {pick(relation.name, locale)}
                  </text>
                </g>
              );
            })}
          </svg>

          {blueprint.types.map((type) => {
            const x = type.layout?.x ?? 0;
            const y = type.layout?.y ?? 0;
            const name = pick(type.name, locale);
            const connecting = connectFrom === type.key;
            return (
              <div
                key={type.key}
                role="group"
                aria-label={name}
                data-testid={`canvas-type-${type.key}`}
                className={cn(
                  "absolute flex flex-col gap-1 rounded-(--radius-md) border bg-surface p-2.5 shadow-(--shadow-raise)",
                  connecting ? "border-brand ring-2 ring-brand/30" : "border-line",
                )}
                style={{ left: x, top: y, width: CARD_WIDTH, height: CARD_HEIGHT }}
              >
                <div className="flex items-center gap-1.5">
                  {readOnly ? null : (
                    <button
                      type="button"
                      aria-label={`${name}. ${messages.canvas.moveHint}`}
                      className="cursor-grab touch-none rounded-(--radius-sm) p-0.5 text-muted hover:bg-surface-soft"
                      onPointerDown={(event) => onPointerDown(event, type.key)}
                      onKeyDown={(event) => onHandleKey(event, type.key, x, y)}
                    >
                      <GripVertical className="size-4" aria-hidden />
                    </button>
                  )}
                  <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
                </div>
                <span className="text-[12px] text-muted">
                  {fill(messages.canvas.propertyCount, { count: type.properties.length })}
                </span>
                {readOnly ? null : (
                  <Button
                    type="button"
                    size="sm"
                    variant={connecting ? "primary" : "ghost"}
                    aria-pressed={connecting}
                    className="mt-auto self-start"
                    onClick={() => connect(type.key)}
                  >
                    <Link2 className="size-3.5" aria-hidden />
                    {connecting ? messages.canvas.cancelConnect : messages.canvas.connect}
                    <span className="sr-only"> {name}</span>
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * `focus:outline-none` used to sit here, and because Tailwind utilities win
 * over the `@layer base` rule in globals.css it silently removed the app-wide
 * focus ring from every field — leaving a 1px border tint as the only focus
 * cue, well under the 3:1 that A11Y-003/UI-007 ask for. The ring is kept for
 * keyboard focus only so pointer users still get the quiet border treatment.
 */
const fieldClasses =
  "w-full rounded-(--radius-sm) border border-line bg-surface px-3 text-sm text-ink " +
  "placeholder:text-muted/70 transition-colors duration-(--duration-fast) " +
  "focus:border-brand disabled:cursor-not-allowed disabled:opacity-60";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, "h-9.5", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(fieldClasses, "min-h-20 py-2 leading-normal", className)}
      {...props}
    />
  );
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldClasses, "h-9.5", className)} {...props}>
      {children}
    </select>
  );
}

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-ink", className)}
      {...props}
    >
      {children}
    </label>
  );
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[12.5px] text-muted">{children}</p>;
}

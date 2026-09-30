/** A labelled progress bar; `value` is 0–100 or null when nothing is measured yet. */
export function ProgressBar({ value, label, text }: { value: number | null; label: string; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value ?? undefined}
        aria-valuetext={text}
        className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-soft"
      >
        <div className="h-full rounded-full bg-brand" style={{ width: `${value ?? 0}%` }} />
      </div>
      <span className="shrink-0 text-[12.5px] text-muted">{text}</span>
    </div>
  );
}

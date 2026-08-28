import { z } from "zod";
import { requiredText } from "@/lib/schema";

/**
 * Outputs and outcomes.
 *
 * A funder's report has two halves and a charity is asked for both: what we
 * did (sessions run, people attended) and what changed because of it (reading
 * confidence rose). Reporting the first while calling it the second is the
 * most common failure in the sector, so the two are kept apart here as they
 * are in the schema.
 */

export const OPERATION_STATUSES = ["planned", "delivered", "cancelled"] as const;
export const METRIC_DIRECTIONS = ["increase", "decrease"] as const;

export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const OPERATION_STATUS_LABELS: Record<OperationStatus, string> = {
  planned: "Planned",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const DIRECTION_LABELS: Record<MetricDirection, string> = {
  increase: "Higher is better",
  decrease: "Lower is better",
};

/** The same arithmetic the database stores, so a form can show it before saving. */
export function contactHours(
  attendees: number | null | undefined,
  durationHours: number | null | undefined,
): number | null {
  if (attendees === null || attendees === undefined) return null;
  if (durationHours === null || durationHours === undefined) return null;
  return Math.round(attendees * durationHours * 10) / 10;
}

export interface DeliverySummary {
  delivered: number;
  planned: number;
  cancelled: number;
  attendees: number;
  contactHours: number;
  volunteerSessions: number;
}

/**
 * Totals for a funder report.
 *
 * Only delivered sessions count. A planned session is an intention and a
 * cancelled one did not happen; including either would overstate delivery,
 * which is the specific way these numbers go wrong.
 */
export function summarizeDelivery(
  operations: {
    status: OperationStatus;
    attendee_count: number | null;
    contact_hours: number | string | null;
    volunteer_count: number | null;
  }[],
): DeliverySummary {
  const summary: DeliverySummary = {
    delivered: 0,
    planned: 0,
    cancelled: 0,
    attendees: 0,
    contactHours: 0,
    volunteerSessions: 0,
  };

  for (const op of operations) {
    if (op.status === "planned") summary.planned += 1;
    if (op.status === "cancelled") summary.cancelled += 1;
    if (op.status !== "delivered") continue;

    summary.delivered += 1;
    summary.attendees += op.attendee_count ?? 0;
    summary.volunteerSessions += op.volunteer_count ?? 0;
    const hours =
      typeof op.contact_hours === "string"
        ? Number(op.contact_hours)
        : (op.contact_hours ?? 0);
    if (Number.isFinite(hours)) summary.contactHours += hours;
  }

  summary.contactHours = Math.round(summary.contactHours * 10) / 10;
  return summary;
}

export interface MetricProgress {
  /** 0–100 toward the target, or null when there is not enough to say. */
  percent: number | null;
  /** True once the target has been reached or passed, in the right direction. */
  met: boolean;
  /** Movement since the baseline, signed in the metric's own units. */
  change: number | null;
  /** True when the latest reading is worse than the baseline. */
  regressed: boolean;
}

/**
 * How far a metric has come.
 *
 * Direction is the whole point. A falling waiting list is progress and a
 * falling attendance figure is not, and a percentage computed without knowing
 * which is which would label half of a charity's measures backwards.
 *
 * Progress is measured from the baseline rather than from zero: a metric that
 * starts at 4.1 and targets 6.8 is at 0%, not 60%.
 */
export function metricProgress(metric: {
  direction: MetricDirection;
  baseline: number | null;
  target: number | null;
  latest: number | null;
}): MetricProgress {
  const { direction, baseline, target, latest } = metric;

  if (latest === null || baseline === null) {
    return { percent: null, met: false, change: null, regressed: false };
  }

  const change = Math.round((latest - baseline) * 100) / 100;
  const improving = direction === "increase" ? change > 0 : change < 0;
  const regressed = direction === "increase" ? change < 0 : change > 0;

  if (target === null) {
    return { percent: null, met: false, change, regressed };
  }

  const span = target - baseline;
  if (span === 0) {
    // The database refuses this, but a metric created before that constraint —
    // or read from an export — should not produce Infinity on a screen.
    return { percent: null, met: latest === target, change, regressed };
  }

  const raw = ((latest - baseline) / span) * 100;
  const percent = Math.max(0, Math.min(100, Math.round(raw)));
  const met = direction === "increase" ? latest >= target : latest <= target;

  return { percent, met, change, regressed: regressed && !improving };
}

const number = z
  .preprocess((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number({ invalid_type_error: "Enter a number." }))
  .optional()
  .nullable();

const wholeNumber = z
  .preprocess((value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    if (typeof value !== "string") return value;
    const parsed = Number(value.replace(/[,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : value;
  }, z.number({ invalid_type_error: "Enter a whole number." }).int("Enter a whole number.").nonnegative("That cannot be negative."))
  .optional()
  .nullable();

export const recordOperationSchema = z
  .object({
    programId: z.string().uuid(),
    projectId: z.string().uuid().nullable().optional(),
    title: requiredText("Give the session a name.", 200),
    occurredOn: requiredText("When did it happen?", 10),
    location: z.string().trim().max(200).optional(),
    status: z.enum(OPERATION_STATUSES).default("planned"),
    attendeeCount: wholeNumber,
    volunteerCount: wholeNumber,
    durationHours: number,
    staffHours: number,
    ledBy: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(5000).optional(),
    cancellationReason: z.string().trim().max(2000).optional(),
  })
  // Both of these mirror CHECK constraints, so the person sees a sentence.
  .refine(
    (v) => v.status !== "cancelled" || Boolean(v.cancellationReason),
    {
      message: "Say why it was cancelled — next year's application will ask.",
      path: ["cancellationReason"],
    },
  )
  .refine(
    (v) =>
      v.status !== "delivered" ||
      (v.attendeeCount !== null && v.attendeeCount !== undefined),
    {
      message: "How many people came? This is the number the record exists for.",
      path: ["attendeeCount"],
    },
  )
  .refine((v) => v.status !== "cancelled" || !v.attendeeCount, {
    message: "A cancelled session had no attendance.",
    path: ["attendeeCount"],
  });

export const createMetricSchema = z
  .object({
    programId: z.string().uuid(),
    name: requiredText("Name what you are trying to change.", 200),
    description: z.string().trim().max(2000).optional(),
    unit: requiredText("What is it measured in?", 60).default("people"),
    direction: z.enum(METRIC_DIRECTIONS).default("increase"),
    baseline: number,
    baselineOn: z.string().trim().max(10).nullable().optional(),
    target: number,
    targetOn: z.string().trim().max(10).nullable().optional(),
    ownerId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) =>
      v.baseline === null ||
      v.baseline === undefined ||
      v.target === null ||
      v.target === undefined ||
      v.target !== v.baseline,
    { message: "A target equal to the baseline is not a target.", path: ["target"] },
  )
  .refine(
    (v) => {
      if (
        v.baseline === null || v.baseline === undefined ||
        v.target === null || v.target === undefined
      ) {
        return true;
      }
      return v.direction === "increase" ? v.target > v.baseline : v.target < v.baseline;
    },
    {
      message:
        "The target moves the wrong way for this direction — check which way counts as better.",
      path: ["target"],
    },
  );

export const recordMeasurementSchema = z.object({
  metricId: z.string().uuid(),
  measuredOn: requiredText("When was it measured?", 10),
  value: z.preprocess(
    (v) => (typeof v === "string" ? Number(v.replace(/[,\s]/g, "")) : v),
    z.number({ invalid_type_error: "Enter the measured value as a number." }),
  ),
  source: z.string().trim().max(200).optional(),
  sampleSize: z
    .preprocess((value) => {
      if (value === "" || value === null || value === undefined) return undefined;
      if (typeof value !== "string") return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : value;
    }, z.number().int().positive("A sample of nobody is not a sample."))
    .optional()
    .nullable(),
  note: z.string().trim().max(2000).optional(),
});

import type { z } from "zod";
import { chartSettingsSchema } from "./d3-chart";

/**
 * Wave 2 unit D3 (charts): the layout ids it adds to the view block and the
 * extra block props they need. Only D3 edits this file (and d3-layouts.tsx).
 * Kept free of React so the block's schema can import it.
 */

/** Layout ids this unit adds, e.g. ["chart"]. Must not repeat a base layout. */
export const D3_LAYOUTS = ["chart"] as const;

/**
 * Extra, optional block props (zod shape) merged into the view block schema.
 * `chart`: the chart's kind and total; it groups by the view's own "Group by".
 */
export const d3PropsShape = {
  chart: chartSettingsSchema.optional(),
} satisfies z.ZodRawShape;

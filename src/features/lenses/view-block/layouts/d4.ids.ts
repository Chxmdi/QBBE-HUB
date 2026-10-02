import type { z } from "zod";

/**
 * Wave 2 unit D4 (timeline, gallery and feed layouts): the layout ids it adds to the view block and the
 * extra block props they need. Only D4 edits this file (and d4-layouts.tsx).
 * Kept free of React so the block's schema can import it.
 */

/** Layout ids this unit adds, e.g. ["chart"]. Must not repeat a base layout. */
export const D4_LAYOUTS = [] as const;

/** Extra, optional block props (zod shape) merged into the view block schema. */
export const d4PropsShape = {} satisfies z.ZodRawShape;

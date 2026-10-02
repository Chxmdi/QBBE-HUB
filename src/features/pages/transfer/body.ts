/**
 * Reading an upload with a hard ceiling (wave 2 unit X1). A body that says
 * its size is refused by the route before this runs; one that does not (a
 * chunked upload) is read only until it passes the ceiling, never buffered
 * whole.
 */

/** The request body, or "tooLarge" as soon as it passes `limit` bytes. */
export async function readAtMost(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | "tooLarge"> {
  if (!request.body) return new Uint8Array(0);
  const out = new Uint8Array(limit);
  let size = 0;
  const reader = request.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out.slice(0, size);
    if (size + value.length > limit) {
      await reader.cancel();
      return "tooLarge";
    }
    out.set(value, size);
    size += value.length;
  }
}

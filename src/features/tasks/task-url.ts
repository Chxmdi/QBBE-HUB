/** Preserve list context while opening or closing a task drawer. */
export function taskDrawerHref(pathname: string, search: string, taskId: string | null): string {
  const params = new URLSearchParams(search);
  if (taskId) params.set("task", taskId);
  else params.delete("task");
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}`;
}

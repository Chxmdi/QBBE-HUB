/**
 * Items whose title starts with what was typed come first: "/embed" should
 * offer Embed before the file blocks that merely list "embed" as an alias.
 * Otherwise the library's order is kept.
 */
export function rankByTitle<T extends { title: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return items;
  const starts = (item: T) => (item.title.toLocaleLowerCase().startsWith(q) ? 0 : 1);
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => starts(a.item) - starts(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

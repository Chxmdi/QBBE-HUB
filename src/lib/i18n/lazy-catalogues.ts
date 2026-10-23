import { LOCALES, type Locale } from "@/lib/i18n/config";

/**
 * A feature's catalogues for the browser, one on-demand file per language
 * (PERF-004).
 *
 * A feature's `catalogues.ts` imports its English and French text together,
 * which server code reads synchronously. In the browser build that module is
 * swapped for its `catalogues.browser.ts` (next.config.ts), which hands back
 * the same shape from here: each language is an object that stands for its
 * catalogue and loads it on first read. So every caller keeps reading
 * `catalogues.en.x` or `catalogues["fr-CA"].x`, and a page downloads only
 * the language it shows.
 *
 * A language loads on its first read. A read during rendering before it has
 * arrived suspends the component until it is there (Suspense), much as the
 * shared catalogue does in I18nProvider: the server renders with the text already in place, so
 * nothing flickers. Read these during rendering, not when a module loads:
 * outside rendering there is nothing to wait with. (Nothing is loaded ahead
 * from the document's `lang`: it can name another language than the one the
 * page renders in.)
 */
export function lazyCatalogues<C extends Record<Locale, object>>(
  loaders: { [L in Locale]: () => Promise<C[L]> },
): C {
  type M = C[Locale];
  const loaded = new Map<Locale, { promise: Promise<M>; value?: M }>();

  function load(locale: Locale) {
    let entry = loaded.get(locale);
    if (!entry) {
      const pending: { promise: Promise<M>; value?: M } = { promise: loaders[locale]() as Promise<M> };
      pending.promise.then((value) => {
        pending.value = value;
      });
      loaded.set(locale, pending);
      entry = pending;
    }
    return entry;
  }

  function read(locale: Locale): M {
    const entry = load(locale);
    if (entry.value) return entry.value;
    // Suspends the rendering component until the file has arrived. Thrown
    // rather than passed to React's `use`: the text is often read inside a
    // memoised value or a library's own callbacks, where `use` is refused.
    throw entry.promise;
  }

  const out = {} as C;
  for (const locale of LOCALES) {
    out[locale] = new Proxy({} as C[typeof locale], {
      get: (_, key) => Reflect.get(read(locale), key),
      has: (_, key) => Reflect.has(read(locale), key),
      ownKeys: () => Reflect.ownKeys(read(locale)),
      getOwnPropertyDescriptor: (_, key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(read(locale), key);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
      },
    });
  }
  return out;
}

/**
 * Makes sure catalogues are loaded for a language before rendering goes on,
 * waiting (suspending) here if they are not. For a component whose children
 * read text where waiting is not possible, such as the editor's blocks,
 * which a library renders inside its own view. Loads every set at once, then
 * waits for all. With the server's static catalogues it does nothing.
 */
export function cataloguesReady(locale: Locale, ...sets: Record<Locale, object>[]): void {
  const pending: Promise<unknown>[] = [];
  for (const set of sets) {
    try {
      Reflect.ownKeys(set[locale]);
    } catch (thrown) {
      if (thrown instanceof Promise) pending.push(thrown);
      else throw thrown;
    }
  }
  if (pending.length > 0) throw Promise.all(pending);
}

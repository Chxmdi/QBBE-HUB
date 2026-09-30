import { getFormatters, getLocale } from "@/lib/i18n/server";
import type { LayoutSection, ObjectLayout } from "../layout";
import { labelFor, layoutsText } from "../messages";
import type { DisplayValue, ObjectPageData } from "../services/layout.queries";

/**
 * An object's page drawn from its type's layout (V2-4). `content`,
 * `comments` and `versions` are slots: integration passes the block editor,
 * the M11 comments panel and the M16 history through `slots`.
 */
export async function ObjectLayoutView({
  layout,
  data,
  slots = {},
}: {
  layout: ObjectLayout;
  data: ObjectPageData;
  slots?: Partial<Record<"content" | "comments" | "versions", React.ReactNode>>;
}) {
  const locale = await getLocale();
  const m = layoutsText(locale);
  const format = await getFormatters();
  const lang = locale === "fr-CA" ? "fr" : "en";

  const heading = (section: LayoutSection) =>
    section.title?.[lang]?.trim() ||
    (section.kind === "related"
      ? labelFor(m.relations as Record<string, string>, section.relation)
      : m.kinds[section.kind]);

  const show = (value: DisplayValue | undefined) => {
    if (!value || value.kind === "empty") return <span className="meta">{m.view.empty}</span>;
    if (value.kind === "date") return <time dateTime={value.iso}>{value.time ? format.dateTime(value.iso) : format.date(value.iso)}</time>;
    if (value.kind === "link")
      return (
        <a href={value.href} className="text-brand-fg hover:underline">
          {value.text}
        </a>
      );
    return value.text;
  };

  return (
    <div className="space-y-6">
      {layout.sections.map((section) => (
        <section key={section.id} aria-labelledby={`layout-${section.id}`}>
          <h2 id={`layout-${section.id}`} className="section-heading mb-2">
            {heading(section)}
          </h2>
          {section.kind === "properties" ? (
            <dl className="card grid gap-x-6 gap-y-2 p-4 sm:grid-cols-[max-content_1fr]">
              {section.properties.map((key) => (
                <div key={key} className="contents">
                  <dt className="meta">{labelFor(m.properties as Record<string, string>, key)}</dt>
                  <dd className="text-[13.5px]">{show(data.values[key])}</dd>
                </div>
              ))}
            </dl>
          ) : section.kind === "related" ? (
            (data.related[section.relation] ?? []).length === 0 ? (
              <p className="meta">{m.view.noneRelated}</p>
            ) : (
              <ul className="card divide-y divide-line">
                {(data.related[section.relation] ?? []).slice(0, section.limit).map((item) => (
                  <li key={item.id} className="px-4 py-2 text-[13.5px]">
                    <a href={item.href} className="text-brand-fg hover:underline">
                      {item.title}
                    </a>
                  </li>
                ))}
              </ul>
            )
          ) : section.kind === "content" ? (
            (slots.content ?? (data.content ? (
              <p className="card whitespace-pre-wrap p-4 text-[13.5px]">{data.content}</p>
            ) : (
              <p className="meta">{m.view.noContent}</p>
            )))
          ) : section.kind === "comments" ? (
            (slots.comments ?? <p className="meta">{m.view.commentsSlot}</p>)
          ) : (
            (slots.versions ?? <p className="meta">{m.view.versionsSlot}</p>)
          )}
        </section>
      ))}
    </div>
  );
}

import { Badge } from "@/components/ui/badge";
import type { Locale } from "@/lib/i18n/config";
import { fill, pick, type BlueprintsMessages } from "../i18n";
import type { BlueprintPreview as Preview } from "../preview";

/** Everything building will create, grouped, with where each item came from. */
export function BlueprintPreview({
  preview,
  messages,
  locale,
  total,
}: {
  preview: Preview;
  messages: BlueprintsMessages;
  locale: Locale;
  total: number;
}) {
  const typeName = (key: string) => {
    const type = preview.types.find((t) => t.key === key);
    return type ? pick(type.name, locale) : key;
  };
  const propertyName = (typeKey: string, key: string) => {
    if (key === "title") return messages.preview.titleProperty;
    const property = preview.types.find((t) => t.key === typeKey)?.properties.find((p) => p.key === key);
    return property ? pick(property.name, locale) : key;
  };
  const source = (from: "blueprint" | "default") => (
    <Badge tone={from === "blueprint" ? "brand" : "neutral"}>
      {from === "blueprint" ? messages.preview.fromBlueprint : messages.preview.byDefault}
    </Badge>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{messages.preview.heading}</h2>
        <p className="mt-1 max-w-2xl text-[13px] text-muted">{messages.preview.intro}</p>
        <p className="mt-2 text-[13px] font-medium text-ink" data-testid="preview-total">
          {fill(messages.preview.total, { count: total })}
        </p>
      </div>

      <Group title={messages.preview.types} count={preview.types.length} none={messages.preview.none}>
        {preview.types.map((type) => (
          <li key={type.key}>
            <span className="font-medium">{pick(type.name, locale)}</span>
            <span className="text-muted">
              {" "}
              · {type.properties.map((p) => `${pick(p.name, locale)} (${messages.kinds[p.kind as keyof BlueprintsMessages["kinds"]]})`).join(", ") || messages.list.noProperties}
            </span>
          </li>
        ))}
      </Group>

      <Group title={messages.preview.relations} count={preview.relations.length} none={messages.preview.none}>
        {preview.relations.map((r) => (
          <li key={r.key}>
            {fill(messages.relations.summary, { from: typeName(r.from), name: pick(r.name, locale), to: typeName(r.to) })}
            <span className="text-muted"> · {messages.cardinality[r.cardinality]}</span>
          </li>
        ))}
      </Group>

      <Group title={messages.preview.lenses} count={preview.lenses.length} none={messages.preview.none}>
        {preview.lenses.map((lens) => (
          <li key={lens.key} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pick(lens.name, locale)}</span>
            <span className="text-muted">
              {messages.lensKinds[lens.kind]}
              {lens.groupBy ? ` · ${fill(messages.preview.groupedBy, { property: propertyName(lens.type, lens.groupBy) })}` : ""}
            </span>
            {source(lens.source)}
          </li>
        ))}
      </Group>

      <Group title={messages.preview.forms} count={preview.forms.length} none={messages.preview.none}>
        {preview.forms.map((form) => (
          <li key={form.key} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pick(form.name, locale)}</span>
            <span className="text-muted">
              {fill(messages.preview.fields, { fields: form.fields.map((f) => propertyName(form.type, f)).join(", ") })}
            </span>
            {source(form.source)}
          </li>
        ))}
      </Group>

      <Group title={messages.preview.workflows} count={preview.workflows.length} none={messages.preview.none}>
        {preview.workflows.map((w) => (
          <li key={w.key}>
            <span className="font-medium">{pick(w.name, locale)}</span>
            <span className="text-muted">
              {" "}
              ·{" "}
              {w.trigger.on === "created"
                ? fill(messages.preview.trigger.created, { type: typeName(w.type) })
                : fill(messages.preview.trigger.property_changed, { property: propertyName(w.type, w.trigger.property) })}
              {" "}· {fill(messages.preview.stepsCount, { count: w.steps.length })}
            </span>
          </li>
        ))}
      </Group>
    </div>
  );
}

function Group({ title, count, none, children }: { title: string; count: number; none: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[13.5px] font-semibold text-ink">
        {title} <span className="font-normal text-muted">({count})</span>
      </h3>
      {count === 0 ? <p className="text-[13px] text-muted">{none}</p> : <ul className="space-y-1.5 text-[13.5px] text-ink">{children}</ul>}
    </section>
  );
}

import Link from "next/link";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { PROJECT_HEALTHS, PROJECT_STAGES, type PortfolioFilters } from "@/features/dashboard/portfolio";
import { getT } from "@/lib/i18n/server";
import type { MessageKey, TranslateFn } from "@/lib/i18n/translate";

const VALUE_KEYS = [
  "on_track", "at_risk", "off_track", "paused", "unknown",
  "proposed", "approved", "planning", "active", "completed", "cancelled", "archived",
  "low", "medium", "high", "critical",
] as const;

function label(value: string, t: TranslateFn) {
  return (VALUE_KEYS as readonly string[]).includes(value)
    ? t(`dashboard.filters.values.${value}` as MessageKey)
    : value;
}

export async function PortfolioFilters({
  filters,
  programs,
  people,
  funders = [],
}: {
  filters: PortfolioFilters;
  programs: { id: string; name: string }[];
  people: { id: string; label: string }[];
  funders?: { id: string; name: string }[];
}) {
  const t = await getT();
  const any = t("dashboard.filters.any");
  return (
    <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
      <FilterSelect anyLabel={any} name="program" label={t("dashboard.filters.program")} value={filters.program} options={programs.map((program) => ({ value: program.id, label: program.name }))} />
      <FilterSelect anyLabel={any} name="owner" label={t("dashboard.filters.owner")} value={filters.owner} options={people.map((person) => ({ value: person.id, label: person.label }))} />
      <FilterSelect anyLabel={any} name="member" label={t("dashboard.filters.member")} value={filters.member} options={people.map((person) => ({ value: person.id, label: person.label }))} />
      <FilterSelect anyLabel={any} name="health" label={t("dashboard.filters.health")} value={filters.health} options={PROJECT_HEALTHS.map((value) => ({ value, label: label(value, t) }))} />
      <FilterSelect anyLabel={any} name="priority" label={t("dashboard.filters.priority")} value={filters.priority} options={["low", "medium", "high", "critical"].map((value) => ({ value, label: label(value, t) }))} />
      <FilterSelect anyLabel={any} name="stage" label={t("dashboard.filters.stage")} value={filters.stage} options={PROJECT_STAGES.map((value) => ({ value, label: label(value, t) }))} />
      <FilterSelect anyLabel={any} name="status" label={t("dashboard.filters.status")} value={filters.status} options={PROJECT_STAGES.map((value) => ({ value, label: label(value, t) }))} />
      <label className="text-[12px] text-muted">
        {t("dashboard.filters.from")}
        <Input className="mt-1 h-9 w-auto" type="date" name="from" defaultValue={filters.from ?? ""} />
      </label>
      <label className="text-[12px] text-muted">
        {t("dashboard.filters.to")}
        <Input className="mt-1 h-9 w-auto" type="date" name="to" defaultValue={filters.to ?? ""} />
      </label>
      {funders.length > 0 ? (
        <FilterSelect
          anyLabel={any}
          name="funding"
          label={t("dashboard.filters.funding")}
          value={filters.funding}
          options={funders.map((funder) => ({ value: funder.id, label: funder.name }))}
        />
      ) : null}
      <label className="flex items-center gap-1.5 pb-2 text-[13px]">
        <Checkbox name="stale" value="1" defaultChecked={filters.stale === "1"} />
        {t("dashboard.filters.staleOnly")}
      </label>
      <button className="h-9 rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white" type="submit">
        {t("dashboard.filters.apply")}
      </button>
      <Link href="/projects" className="pb-2 text-[13px] text-muted hover:underline">
        {t("dashboard.filters.clear")}
      </Link>
    </form>
  );
}

function FilterSelect({
  name,
  label: fieldLabel,
  value,
  options,
  anyLabel,
}: {
  anyLabel: string;
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-[12px] text-muted">
      {fieldLabel}
      <Select className="mt-1 h-9 max-w-40" name={name} defaultValue={value ?? ""}>
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

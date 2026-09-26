import Link from "next/link";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { PROJECT_HEALTHS, PROJECT_STAGES, type PortfolioFilters } from "@/features/dashboard/portfolio";

const LABELS: Record<string, string> = {
  on_track: "On track",
  at_risk: "At risk",
  off_track: "Off track",
  paused: "Paused",
  unknown: "Unknown",
  proposed: "Proposed",
  approved: "Approved",
  planning: "Planning",
  active: "Active",
  completed: "Completed",
  cancelled: "Cancelled",
  archived: "Archived",
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

function label(value: string) {
  return LABELS[value] ?? value;
}

export function PortfolioFilters({
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
  return (
    <form className="mb-4 flex flex-wrap items-end gap-3" method="get">
      <FilterSelect name="program" label="Program" value={filters.program} options={programs.map((program) => ({ value: program.id, label: program.name }))} />
      <FilterSelect name="owner" label="Owner" value={filters.owner} options={people.map((person) => ({ value: person.id, label: person.label }))} />
      <FilterSelect name="member" label="Team member" value={filters.member} options={people.map((person) => ({ value: person.id, label: person.label }))} />
      <FilterSelect name="health" label="Health" value={filters.health} options={PROJECT_HEALTHS.map((value) => ({ value, label: label(value) }))} />
      <FilterSelect name="priority" label="Priority" value={filters.priority} options={["low", "medium", "high", "critical"].map((value) => ({ value, label: label(value) }))} />
      <FilterSelect name="stage" label="Stage" value={filters.stage} options={PROJECT_STAGES.map((value) => ({ value, label: label(value) }))} />
      <FilterSelect name="status" label="Status" value={filters.status} options={PROJECT_STAGES.map((value) => ({ value, label: label(value) }))} />
      <label className="text-[12px] text-muted">
        From
        <Input className="mt-1 h-9 w-auto" type="date" name="from" defaultValue={filters.from ?? ""} />
      </label>
      <label className="text-[12px] text-muted">
        To
        <Input className="mt-1 h-9 w-auto" type="date" name="to" defaultValue={filters.to ?? ""} />
      </label>
      {funders.length > 0 ? (
        <FilterSelect
          name="funding"
          label="Funding source"
          value={filters.funding}
          options={funders.map((funder) => ({ value: funder.id, label: funder.name }))}
        />
      ) : null}
      <label className="flex items-center gap-1.5 pb-2 text-[13px]">
        <Checkbox name="stale" value="1" defaultChecked={filters.stale === "1"} />
        Stale only
      </label>
      <button className="h-9 rounded-(--radius-sm) bg-brand px-3 text-[13px] font-medium text-white" type="submit">
        Apply
      </button>
      <Link href="/projects" className="pb-2 text-[13px] text-muted hover:underline">
        Clear
      </Link>
    </form>
  );
}

function FilterSelect({
  name,
  label: fieldLabel,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="text-[12px] text-muted">
      {fieldLabel}
      <Select className="mt-1 h-9 max-w-40" name={name} defaultValue={value ?? ""}>
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

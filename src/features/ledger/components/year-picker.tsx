import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import type { FiscalYear } from "@/features/ledger/year-end";

/** Chooses a fiscal year with a plain GET form, so each year has its own URL. */
export function YearPicker({ years, selected }: { years: FiscalYear[]; selected: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 print:hidden" aria-label="Fiscal year">
      <div className="min-w-48">
        <Label htmlFor="fiscal-year">Fiscal year</Label>
        <Select id="fiscal-year" name="year" defaultValue={selected}>
          {years.map((y) => (
            <option key={y.startsOn} value={y.startsOn}>
              {y.startsOn} to {y.endsOn}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        Show
      </Button>
    </form>
  );
}

/** The label every year-end figure carries. */
export function NotFiledNotice() {
  return (
    <p className="mb-4 rounded-(--radius-sm) border border-warning/40 bg-warning/10 px-3 py-2 text-[13.5px] text-warning-fg">
      Prepared for your accountant, not filed. Nothing here is sent to the CRA or Revenu Québec.
    </p>
  );
}

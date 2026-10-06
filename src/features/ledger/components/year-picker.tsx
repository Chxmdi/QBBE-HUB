import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import type { FiscalYear } from "@/features/ledger/year-end";
import { getT } from "@/lib/i18n/server";

/** Chooses a fiscal year with a plain GET form, so each year has its own URL. */
export async function YearPicker({ years, selected }: { years: FiscalYear[]; selected: string }) {
  const t = await getT();
  return (
    <form
      method="get"
      className="flex flex-wrap items-end gap-3 print:hidden"
      aria-label={t("finance.ledgerReports.yearPicker.label")}
    >
      <div className="min-w-48">
        <Label htmlFor="fiscal-year">{t("finance.ledgerReports.yearPicker.label")}</Label>
        <Select id="fiscal-year" name="year" defaultValue={selected}>
          {years.map((y) => (
            <option key={y.startsOn} value={y.startsOn}>
              {t("finance.ledgerReports.dateRange", { from: y.startsOn, to: y.endsOn })}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="secondary">
        {t("finance.ledgerReports.show")}
      </Button>
    </form>
  );
}

/** The label every year-end figure carries. */
export async function NotFiledNotice() {
  const t = await getT();
  return (
    <p className="mb-4 rounded-(--radius-sm) border border-warning/40 bg-warning/10 px-3 py-2 text-[13.5px] text-warning-fg">
      {t("finance.ledgerReports.yearPicker.notFiled")}
    </p>
  );
}

"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/client";
import type { LocalizedText } from "@/lib/objects/contracts";
import type { CatalogProperty, CatalogType } from "@/lib/query/catalog";
import { localized } from "@/lib/query/catalog";
import { useLensT } from "@/features/lenses/i18n/client";
import type { ImportResponse } from "@/app/api/objects/import/route";
import { validateRows, type ImportRefs, type RowError } from "./import";
import { importableProperties, isImportType, mappingProblems, REQUIRED, suggestMapping, type ColumnMapping, type ImportTypeKey } from "./mapping";
import { parseCsv, type ParsedCsv } from "./parse";

/**
 * The CSV import wizard (Workspace OS U15): file, columns, preview, result.
 * Reading and validation happen in the browser with the same code the
 * server runs, so the preview shows exactly what the import will do; the
 * import itself is one request that creates the rows as one change set,
 * which the result step can undo.
 */

export const PREVIEW_ROWS = 20;
const ERRORS_SHOWN = 50;

type Step = "upload" | "map" | "preview" | "done";
const STEPS: Step[] = ["upload", "map", "preview", "done"];

export function ImportWizard({
  types,
  initialType,
  refs,
  limit,
}: {
  types: CatalogType[];
  initialType: ImportTypeKey;
  refs: ImportRefs;
  limit: number;
}) {
  const t = useLensT();
  const locale = useLocale();
  const text = React.useCallback((m: LocalizedText) => (locale.startsWith("fr") ? m.fr : m.en), [locale]);
  const fileId = React.useId();
  const pasteId = React.useId();
  const typeId = React.useId();

  const [step, setStep] = React.useState<Step>("upload");
  const [typeKey, setTypeKey] = React.useState<ImportTypeKey>(initialType);
  const [pasted, setPasted] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [parsed, setParsed] = React.useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping>({});
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ImportResponse | null>(null);
  const [undo, setUndo] = React.useState<"idle" | "busy" | "done" | "failed">("idle");
  const [undoMessage, setUndoMessage] = React.useState("");

  const type = types.find((x) => x.key === typeKey) ?? null;
  const properties = React.useMemo(() => (type ? importableProperties(type) : []), [type]);
  const byKey = React.useMemo(() => new Map(properties.map((p) => [p.key, p])), [properties]);
  const required = REQUIRED[typeKey];

  const reset = () => {
    setStep("upload");
    setParsed(null);
    setMapping({});
    setFile(null);
    setPasted("");
    setNotice("");
    setError("");
    setResult(null);
    setUndo("idle");
    setUndoMessage("");
  };

  // ----- 1. File ---------------------------------------------------------

  const read = async () => {
    setError("");
    setBusy(true);
    try {
      const raw = file ? await file.text() : pasted;
      const csv = parseCsv(raw);
      if (csv.headers.length === 0) {
        setError(t("csv.noHeader"));
        return;
      }
      if (csv.rows.length === 0) {
        setError(t("csv.empty"));
        return;
      }
      if (csv.rows.length > limit) {
        setError(t("csv.tooManyRows", { max: limit }));
        return;
      }
      setParsed(csv);
      setMapping(suggestMapping(csv.headers, properties));
      setNotice(
        csv.rows.length === 1
          ? t("csv.rowsFoundOne", { columns: csv.headers.length })
          : t("csv.rowsFound", { count: csv.rows.length, columns: csv.headers.length }),
      );
      setStep("map");
    } catch {
      setError(t("csv.readFailed"));
    } finally {
      setBusy(false);
    }
  };

  // ----- 2. Columns ------------------------------------------------------

  const problems = React.useMemo(() => mappingProblems(mapping, typeKey), [mapping, typeKey]);
  const mappingOk = problems.missing.length === 0 && problems.duplicated.length === 0;

  // ----- 3. Preview ------------------------------------------------------

  const validation = React.useMemo(
    () => (parsed && type ? validateRows({ type, headers: parsed.headers, rows: parsed.rows, mapping, refs }) : null),
    [parsed, type, mapping, refs],
  );
  const errorsByRow = React.useMemo(() => {
    const map = new Map<number, RowError[]>();
    for (const e of validation?.errors ?? []) map.set(e.row, [...(map.get(e.row) ?? []), e]);
    return map;
  }, [validation]);
  const mappedColumns = React.useMemo(
    () =>
      (parsed?.headers ?? [])
        .map((header, index) => ({ header, index, property: mapping[header] ? byKey.get(mapping[header]!) : undefined }))
        .filter((c): c is { header: string; index: number; property: CatalogProperty } => c.property !== undefined),
    [parsed, mapping, byKey],
  );

  const run = async () => {
    if (!parsed || !validation) return;
    setError("");
    setBusy(true);
    try {
      const rows = parsed.rows.map((cells) => Object.fromEntries(parsed.headers.map((h, i) => [h, cells[i] ?? ""])));
      const response = await fetch("/api/objects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ typeKey, mapping, rows }),
      });
      const body = (await response.json().catch(() => null)) as (ImportResponse & { error?: string; message?: unknown }) | null;
      if (!response.ok || !body || typeof body.created !== "number") {
        const reason =
          response.status === 429
            ? t("csv.rateLimited")
            : response.status === 403
              ? t("csv.forbidden")
              : body && typeof body.message === "object" && body.message
                ? text(body.message as LocalizedText)
                : typeof body?.message === "string"
                  ? body.message
                  : (body?.error ?? String(response.status));
        setError(t("csv.runFailed", { reason }));
        return;
      }
      setResult(body);
      setStep("done");
    } catch (cause) {
      setError(t("csv.runFailed", { reason: cause instanceof Error ? cause.message : String(cause) }));
    } finally {
      setBusy(false);
    }
  };

  // ----- 4. Result -------------------------------------------------------

  const undoImport = async () => {
    if (!result?.changeSetId) return;
    setUndo("busy");
    setUndoMessage(t("csv.undoing"));
    try {
      const response = await fetch(`/api/objects/change-sets/${result.changeSetId}/undo`, { method: "POST" });
      if (response.ok) {
        setUndo("done");
        setUndoMessage(t("csv.undone"));
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
      setUndo("failed");
      setUndoMessage(response.status === 409 ? t("csv.undoConflict") : t("csv.undoFailed", { reason: body?.message ?? body?.error ?? String(response.status) }));
    } catch (cause) {
      setUndo("failed");
      setUndoMessage(t("csv.undoFailed", { reason: cause instanceof Error ? cause.message : String(cause) }));
    }
  };

  // ----- Render ----------------------------------------------------------

  const stepIndex = STEPS.indexOf(step);
  const tableHref = `/lenses/table?type=${typeKey}`;

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" aria-label={t("csv.title")}>
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? "step" : undefined}
            className={i === stepIndex ? "font-semibold text-ink" : i < stepIndex ? "text-ink" : "text-muted"}
          >
            {t(`csv.steps.${s}`)}
          </li>
        ))}
      </ol>

      <p role="status" aria-live="polite" className="text-[13px] text-muted">
        {notice}
      </p>
      {error ? (
        <p role="alert" className="text-[13.5px] text-danger-fg">
          {error}
        </p>
      ) : null}

      {step === "upload" ? (
        <form
          className="max-w-2xl space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            void read();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={typeId} className="text-[13px] font-medium text-ink">
              {t("csv.type")}
            </label>
            <Select
              id={typeId}
              className="w-auto"
              value={typeKey}
              onChange={(e) => {
                if (isImportType(e.target.value)) setTypeKey(e.target.value);
              }}
            >
              {types.map((x) => (
                <option key={x.key} value={x.key}>
                  {x.key === "task" || x.key === "project" ? t(`types.${x.key}`) : localized(x.name, locale)}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={fileId} className="text-[13px] font-medium text-ink">
              {t("csv.file")}
            </label>
            <Input
              id={fileId}
              type="file"
              accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
              aria-describedby={`${fileId}-hint`}
              className="h-auto py-2 file:mr-3 file:rounded-(--radius-sm) file:border-0 file:bg-surface-soft file:px-3 file:py-1 file:text-[13px] file:text-ink"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p id={`${fileId}-hint`} className="text-[12.5px] text-muted">
              {t("csv.fileHint")}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={pasteId} className="text-[13px] font-medium text-ink">
              {t("csv.paste")}
            </label>
            <Textarea
              id={pasteId}
              value={pasted}
              aria-describedby={`${pasteId}-hint`}
              onChange={(e) => setPasted(e.target.value)}
              rows={6}
              className="font-mono text-[12.5px]"
            />
            <p id={`${pasteId}-hint`} className="text-[12.5px] text-muted">
              {t("csv.pasteHint")}
            </p>
          </div>
          <Button type="submit" loading={busy} disabled={busy || (!file && pasted.trim() === "")}>
            {busy ? t("csv.reading") : t("csv.read")}
          </Button>
        </form>
      ) : null}

      {step === "map" && parsed ? (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-(--radius-md) border border-line">
            <table className="w-full text-[13.5px]">
              <caption className="sr-only">{t("csv.steps.map")}</caption>
              <thead className="bg-surface-soft text-left text-[12.5px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">{t("csv.column")}</th>
                  <th scope="col" className="px-3 py-2">{t("csv.sample")}</th>
                  <th scope="col" className="px-3 py-2">{t("csv.property")}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.headers.map((header, i) => {
                  const current = mapping[header] ?? "";
                  const duplicated = current !== "" && problems.duplicated.includes(current);
                  return (
                    <tr key={header} className="border-t border-line">
                      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{header}</th>
                      <td className="max-w-60 truncate px-3 py-2 text-muted">{parsed.rows[0]?.[i] ?? ""}</td>
                      <td className="px-3 py-2">
                        <Select
                          aria-label={t("csv.mapFor", { column: header })}
                          aria-invalid={duplicated || undefined}
                          className="min-w-48"
                          value={current}
                          onChange={(e) => setMapping((m) => ({ ...m, [header]: e.target.value || null }))}
                        >
                          <option value="">{t("csv.skip")}</option>
                          {properties.map((p) => (
                            <option key={p.key} value={p.key}>
                              {localized(p.name, locale)}
                              {required.includes(p.key) ? ` (${t("csv.required")})` : ""}
                            </option>
                          ))}
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!mappingOk ? (
            <p role="alert" className="text-[13.5px] text-danger-fg">
              {problems.missing.length > 0 ? t("csv.missingTitle") : t("csv.duplicated")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => { setStep("upload"); setNotice(""); }}>
              {t("csv.back")}
            </Button>
            <Button type="button" disabled={!mappingOk} onClick={() => { setStep("preview"); setError(""); }}>
              {t("csv.next")}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "preview" && parsed && validation ? (
        <div className="space-y-4">
          <p className="text-[13.5px] text-ink" data-testid="import-summary">
            {t("csv.summary", { valid: validation.rows.length, invalid: validation.total - validation.rows.length })}
          </p>
          <div className="overflow-x-auto rounded-(--radius-md) border border-line">
            <table className="w-full text-[13.5px]">
              <caption className="px-3 py-2 text-left text-[12.5px] text-muted">
                {t("csv.previewTitle", { count: Math.min(PREVIEW_ROWS, parsed.rows.length) })}. {t("csv.previewCaption")}
              </caption>
              <thead className="bg-surface-soft text-left text-[12.5px] uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">{t("csv.row")}</th>
                  {mappedColumns.map((c) => (
                    <th key={c.header} scope="col" className="px-3 py-2">{localized(c.property.name, locale)}</th>
                  ))}
                  <th scope="col" className="px-3 py-2">{t("csv.status")}</th>
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, PREVIEW_ROWS).map((cells, i) => {
                  const row = i + 1;
                  const rowErrors = errorsByRow.get(row) ?? [];
                  return (
                    <tr key={row} className="border-t border-line align-top" data-row-status={rowErrors.length ? "problem" : "ok"}>
                      <th scope="row" className="px-3 py-2 text-left font-medium text-ink">{row}</th>
                      {mappedColumns.map((c) => (
                        <td key={c.header} className="max-w-60 truncate px-3 py-2">{cells[c.index] ?? ""}</td>
                      ))}
                      <td className={rowErrors.length ? "px-3 py-2 text-danger-fg" : "px-3 py-2 text-success-fg"}>
                        {rowErrors.length ? rowErrors.map((e) => text(e.message)).join(" ") : t("csv.ok")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {validation.errors.some((e) => e.row > PREVIEW_ROWS || e.row === 0) ? (
            <ErrorList errors={validation.errors.filter((e) => e.row > PREVIEW_ROWS || e.row === 0)} text={text} t={t} />
          ) : null}
          {validation.rows.length === 0 ? (
            <p role="alert" className="text-[13.5px] text-danger-fg">{t("csv.allInvalid")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setStep("map")} disabled={busy}>
              {t("csv.back")}
            </Button>
            <Button type="button" onClick={run} loading={busy} disabled={busy || validation.rows.length === 0}>
              {busy
                ? t("csv.running")
                : validation.rows.length === 1
                  ? t("csv.runOne")
                  : t("csv.run", { count: validation.rows.length })}
            </Button>
          </div>
        </div>
      ) : null}

      {step === "done" && result ? (
        <div className="space-y-4" aria-live="polite">
          <h2 className="text-[16px] font-semibold text-ink">{t("csv.done")}</h2>
          <p className="text-[13.5px] text-ink" data-testid="import-result">
            {result.created === 0
              ? t("csv.nothing")
              : result.created === 1
                ? t("csv.createdOne")
                : t("csv.created", { count: result.created })}{" "}
            {result.skipped === 1 ? t("csv.skippedOne") : result.skipped > 1 ? t("csv.skipped", { count: result.skipped }) : ""}
          </p>
          {result.errors.length > 0 ? <ErrorList errors={result.errors} text={text} t={t} /> : null}
          {undoMessage ? (
            <p role="status" className={undo === "failed" ? "text-[13.5px] text-danger-fg" : "text-[13.5px] text-ink"}>
              {undoMessage}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {result.changeSetId && result.undoAvailable ? (
              <Button type="button" variant="secondary" onClick={undoImport} loading={undo === "busy"} disabled={undo !== "idle"}>
                {t("csv.undo")}
              </Button>
            ) : null}
            <Link href={tableHref} className="text-[13.5px] font-medium text-brand-fg hover:underline">
              {t("csv.openTable")}
            </Link>
            <Button type="button" variant="ghost" onClick={reset} title={t("csv.startOverHint")}>
              {t("csv.startOver")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ErrorList({
  errors,
  text,
  t,
}: {
  errors: RowError[];
  text: (m: LocalizedText) => string;
  t: ReturnType<typeof useLensT>;
}) {
  const shown = errors.slice(0, ERRORS_SHOWN);
  return (
    <section className="space-y-1.5">
      <h3 className="text-[13.5px] font-semibold text-ink">{t("csv.errorsTitle")}</h3>
      <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-danger-fg">
        {shown.map((e, i) => (
          <li key={`${e.row}-${e.column ?? ""}-${i}`}>
            {e.row > 0 ? t("csv.rowLabel", { row: e.row }) : ""}
            {text(e.message)}
          </li>
        ))}
        {errors.length > shown.length ? <li className="text-muted">{t("csv.moreErrors", { count: errors.length - shown.length })}</li> : null}
      </ul>
    </section>
  );
}

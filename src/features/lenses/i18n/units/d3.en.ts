/**
 * Wave 2 unit D3: its lenses strings, read as t("units.d3.…"). Only D3 edits
 * this file and d3.fr-CA.ts (which must have exactly the same keys).
 */
export const d3LensesEn = {
  layout: "Chart",
  kinds: {
    bar: "Bar chart",
    line: "Line chart",
    pie: "Pie chart",
    number: "Single number",
  },
  settings: {
    kind: "Chart type",
    total: "Total",
    count: "Count of records",
    sum: "Sum of {property}",
    avg: "Average of {property}",
    groupHint: "Bar, line and pie charts show one figure for each value of “Group by”. Without one, tasks group by status and projects by stage.",
  },
  figure: {
    summary: "{kind}: {measure} by {group}",
    summaryNumber: "{kind}: {measure}",
    count: "Count",
    noValue: "No value",
    other: "Other",
    share: "Share",
    showTable: "Show the numbers",
    hideTable: "Hide the numbers",
    moreGroups: "{count} more groups are listed in the numbers.",
  },
  states: {
    loading: "Loading the chart…",
    empty: "Nothing to chart: no records you can see match this view.",
    failed: "This chart could not be loaded.",
    invalid: "This chart’s settings are not valid. A sum or an average needs a number property.",
    needsGroup: "This chart needs a “Group by” property its records have. Choose one in its settings.",
    missing: "The lens this chart shows no longer exists, or is not shared with you.",
    off: "Views are turned off for this workspace.",
    retry: "Try again",
  },
};

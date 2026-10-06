/**
 * Wave 2 unit D4: its lenses strings, read as t("units.d4.…"). Only D4 edits
 * this file and d4.fr-CA.ts (which must have exactly the same keys).
 */
export const d4LensesEn = {
  layouts: { timeline: "Timeline", feed: "Feed" },
  settings: {
    timelineStart: "Bars start on",
    timelineEnd: "Bars end on",
    automatic: "Automatic",
    automaticNamed: "Automatic ({name})",
    noEnd: "No end date",
    cover: "Card cover",
    noCover: "No cover",
    feedDate: "Entries placed by",
    noDates: "This type has no dates, so its records cannot be placed in time.",
  },
  timeline: {
    label: "{heading} timeline",
    hint: "Arrow keys move between records, Home and End jump to the first and last.",
    range: "From {from} to {to}",
    today: "Today",
    bar: "{title}: {start} to {end}",
    barOne: "{title}: {date}",
    noStart: "{title}: ends {date}, no start date",
    noEnd: "{title}: starts {date}, no end date",
    noDates: "{title}: no dates",
    noDatesShort: "No dates",
    noStartShort: "No start date",
    noEndShort: "No end date",
    noDateProperty: "This type has no dates to place records on.",
    allUndated: "None of these records have dates yet.",
  },
  gallery: {
    coverLabel: "{name}: {value}",
    coverEmpty: "{name}: not set",
  },
  feed: {
    label: "{heading} feed",
    noDate: "No date",
  },
};

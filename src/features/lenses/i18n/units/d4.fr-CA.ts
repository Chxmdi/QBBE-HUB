import type { d4LensesEn } from "./d4.en";

/** Wave 2 unit D4: its lenses strings in Québec French. Only D4 edits this file. */
export const d4LensesFrCA: typeof d4LensesEn = {
  layouts: { timeline: "Échéancier", feed: "Fil" },
  settings: {
    timelineStart: "Les barres commencent le",
    timelineEnd: "Les barres finissent le",
    automatic: "Automatique",
    automaticNamed: "Automatique ({name})",
    noEnd: "Aucune date de fin",
    cover: "Couverture des fiches",
    noCover: "Aucune couverture",
    feedDate: "Entrées placées selon",
    noDates: "Ce type n’a aucune date, ses fiches ne peuvent donc pas être placées dans le temps.",
  },
  timeline: {
    label: "Échéancier : {heading}",
    hint: "Les flèches passent d’une fiche à l’autre; Début et Fin vont à la première et à la dernière.",
    range: "Du {from} au {to}",
    today: "Aujourd’hui",
    bar: "{title} : du {start} au {end}",
    barOne: "{title} : {date}",
    noStart: "{title} : se termine le {date}, aucune date de début",
    noEnd: "{title} : commence le {date}, aucune date de fin",
    noDates: "{title} : aucune date",
    noDatesShort: "Aucune date",
    noStartShort: "Aucune date de début",
    noEndShort: "Aucune date de fin",
    noDateProperty: "Ce type n’a aucune date pour placer les fiches.",
    allUndated: "Aucune de ces fiches n’a encore de date.",
  },
  gallery: {
    coverLabel: "{name} : {value}",
    coverEmpty: "{name} : non défini",
  },
  feed: {
    label: "Fil : {heading}",
    noDate: "Aucune date",
  },
};

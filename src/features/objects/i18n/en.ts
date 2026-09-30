/** English strings for the object layer (Workspace OS S1). French in ./fr-CA.ts, same keys. */
export const objectsEn = {
  common: {
    eyebrow: "Object",
    untitled: "Untitled",
  },
  related: {
    title: "Related",
    description: "Everything linked to this {type}, in both directions.",
    count: "{count} linked",
    empty: "Nothing is linked yet",
    emptyDescription: "Links appear here when this item is added to a project, depends on a task, or is linked to anything else.",
    hidden: "Some links are not shown because you do not have access to the other item.",
    open: "Open {title}",
    source: {
      native: "From the record itself",
      stored: "Added as a link",
    },
  },
  page: {
    notFound: "This item does not exist, or you do not have access to it.",
    archived: "Archived",
  },
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type ObjectsMessages = Shape<typeof objectsEn>;

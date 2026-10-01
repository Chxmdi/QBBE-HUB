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
  record: {
    sections: {
      properties: "Properties",
      related: "Related",
      content: "Content",
      comments: "Comments",
      versions: "Version history",
    },
    properties: {
      none: "This section has no properties to show.",
      readOnly: "You can see these properties but not change them.",
      empty: "Empty",
      save: "Save {name}",
      saving: "Saving…",
      saved: "Saved.",
      undo: "Undo",
      undoing: "Undoing…",
      undone: "Change undone.",
      noChange: "Nothing to save: the value has not changed.",
      failed: "The change could not be saved. Try again.",
      forbidden: "You do not have permission to change this property.",
      conflict: "Someone changed this since you opened the page. Reload to see the latest value.",
      undoFailed: "The change could not be undone.",
      undoExpired: "Changes older than 30 days cannot be undone.",
      clear: "Clear {name}",
      start: "{name}: start",
      end: "{name}: end",
      yes: "Yes",
      no: "No",
      nobody: "Nobody",
      noChoice: "No choice",
      choices: "{name}: choices",
      formulaError: "This formula could not be calculated: {message}",
      linksNone: "No linked items",
      filesNone: "No files",
      openLink: "Open {title}",
      why: "Why can this not be edited?",
      derived: {
        formula: "Calculated from a formula, so it cannot be edited.",
        rollup: "Summarised from related items, so it cannot be edited.",
        created_by: "Set automatically when the item was created.",
        created_time: "Set automatically when the item was created.",
        edited_by: "Set automatically whenever the item changes.",
        edited_time: "Set automatically whenever the item changes.",
        relation: "Links are changed from the Related section.",
        file: "Files are attached from the document library.",
        system: "This field is kept on the original record and cannot be changed here.",
      },
    },
    content: {
      later: "Content for this kind of item is coming later.",
      editorOff: "The content editor is not turned on for this workspace.",
      label: "Content of {title}",
    },
    versions: {
      unsupported: "Versions are not kept for this kind of item yet.",
    },
    related: {
      loadFailed: "Related items could not be loaded.",
    },
    section: {
      error: "This section could not be loaded. Reload the page to try again.",
      loading: "Loading {name}…",
    },
  },
};

type Shape<T> = { [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type ObjectsMessages = Shape<typeof objectsEn>;

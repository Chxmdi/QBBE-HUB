/**
 * Wave 2 unit X1: its pages strings, read as t("units.x1.…"). Only X1 edits
 * this file and x1.fr-CA.ts (which must have exactly the same keys).
 */
export const x1PagesEn = {
  export: {
    button: "Export",
    label: "Export {title} as Markdown",
    working: "Preparing the export…",
    done: "Export downloaded: {file}",
    failed: "The export could not be made. Check your connection and try again.",
    notFound: "This page is no longer yours to export.",
    retry: "Try the export again",
    viewName: "View {index}",
  },
  import: {
    button: "Import",
    workspaceLabel: "Import a file as a workspace page",
    privateLabel: "Import a file as a private page",
    title: "Import a page",
    intro: "Choose a Markdown (.md) or HTML (.html) file of up to 1 MB. It becomes a new page with the same headings, lists, quotes, code and tables. Anything that could run, such as scripts or embedded frames, is left out.",
    workspaceArea: "The page is added to the workspace, where your team can read it.",
    privateArea: "The page is added to your private pages, where only you can read it.",
    file: "File to import",
    noFile: "No file chosen",
    submit: "Import the file",
    working: "Importing…",
    errors: {
      noFile: "Choose a file first.",
      unsupported: "This kind of file cannot be imported. Choose a Markdown (.md, .markdown, .txt) or HTML (.html, .htm) file.",
      tooLarge: "This file is larger than 1 MB. Split it into smaller files and import each one.",
      empty: "This file is empty.",
      unreadable: "This file is not readable text (it must be saved as UTF-8).",
      forbidden: "You cannot add pages here.",
      failed: "The import did not work. Check your connection and try again.",
    },
  },
};

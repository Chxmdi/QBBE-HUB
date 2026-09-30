/**
 * English strings for the lens screens (Workspace OS S4). Kept in the module
 * until integration mounts them in the shared catalogue; fr-CA.ts is typed
 * against this file, so a missing French string is a compile error.
 */
export const lensesEn = {
  common: {
    notSet: "Not set",
    loadFailed: "This lens could not be loaded.",
    loadFailedDetail: "Try again. If it keeps happening, the filters may no longer apply.",
    tryAgain: "Try again",
    empty: "No records match.",
    rows: "{count} rows",
    rowsOne: "1 row",
    loadingMore: "Loading more rows…",
    type: "Records",
  },
  table: {
    title: "Table",
    description: "Every record you can see, as rows and columns. Edit a cell in place.",
    gridLabel: "{type} table",
    search: "Search titles",
    columns: "Columns",
    columnsLabel: "Show or hide columns",
    groupBy: "Group by",
    noGrouping: "No grouping",
    sum: "Sum",
    columnMenu: "Options for the {name} column",
    sortAsc: "Sort ascending",
    sortDesc: "Sort descending",
    clearSort: "Clear sort",
    moveLeft: "Move left",
    moveRight: "Move right",
    wider: "Wider",
    narrower: "Narrower",
    hide: "Hide column",
    groupByThis: "Group by this column",
    resize: "Resize the {name} column",
    editHint: "Arrow keys move between cells. Enter edits a cell, Escape cancels, Enter saves.",
    edit: "Edit {name}",
    saved: "Saved.",
    saveFailed: "Not saved: {reason}",
    readOnly: "This cell cannot be edited here.",
    groupRow: "{label}: {count}",
    collapse: "Collapse {label}",
    expand: "Expand {label}",
    total: "Total",
    open: "Open {title}",
  },
  board: {
    title: "Board",
    description: "The same tasks as the board, read through the lens engine.",
    moved: "{title} moved to {column}.",
    showMore: "Show {count} more",
    emptyColumn: "No tasks here.",
    unsupported: "The label filter is not available on this lens yet, so it is not applied.",
  },
  myWork: {
    title: "My work",
    description: "Your tasks and your review queue, read through the lens engine.",
    review: "Waiting for your review",
    blocked: "Blocked",
    overdue: "Overdue",
    today: "Due today",
    thisWeek: "This week",
    later: "Later or no date",
  },
  list: {
    title: "List",
    description: "Every record you can see, as a list.",
    noProject: "No project",
  },
  types: {
    task: "Tasks",
    project: "Projects",
  },
};

export type LensMessages = typeof lensesEn;

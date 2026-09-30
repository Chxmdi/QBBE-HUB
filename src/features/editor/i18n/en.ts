/** English strings for the Workspace OS block editor (M4b). */
export const editorEn = {
  label: "Document content",
  keyboardHint:
    "Type / to add a block. Ctrl+/ opens the block menu. Alt+F10 moves to the formatting toolbar. Ctrl+Shift+Up or Down moves a block. Escape, then Tab, leaves the editor.",
  loading: "Loading the editor…",
  save: {
    saving: "Saving…",
    saved: "Saved",
    failed: "Couldn't save. Your changes are kept and will be retried.",
    offline: "Offline. Your changes will be saved when you're back online.",
    conflict: "Someone else saved this in another window. Reload to see the latest version; your last changes were not saved.",
    forbidden: "You can no longer change this. Your last changes were not saved.",
  },
  blockMenu: {
    label: "Block menu",
    moveUp: "Move block up",
    moveDown: "Move block down",
    duplicate: "Duplicate block",
    delete: "Delete block",
    turnInto: "Turn into {type}",
    moved: "Block moved.",
    deleted: "Block deleted.",
  },
  types: {
    paragraph: "Text",
    heading1: "Heading 1",
    heading2: "Heading 2",
    heading3: "Heading 3",
    bulletListItem: "Bulleted list",
    numberedListItem: "Numbered list",
    checkListItem: "To-do list",
    toggleListItem: "Toggle list",
    quote: "Quote",
    callout: "Callout",
    codeBlock: "Code",
  },
  slash: {
    group: "Workspace",
    callout: { title: "Callout", subtext: "A highlighted note with a tone", aliases: "callout,note,info,warning,tip" },
    bookmark: { title: "Bookmark", subtext: "A link shown as a card", aliases: "bookmark,link,url" },
    embed: {
      title: "Embed",
      subtext: "YouTube, Vimeo, Google Docs, Sheets, Slides, Forms, Drive or Loom",
      aliases: "embed,video,youtube,vimeo,google,loom,iframe",
    },
  },
  callout: {
    tone: "Callout tone",
    info: "Information",
    success: "Success",
    warning: "Warning",
    danger: "Important",
  },
  bookmark: {
    inputLabel: "Link address (https)",
    placeholder: "https://example.org/article",
    add: "Add bookmark",
    invalid: "Enter an https:// address.",
    open: "Open {url} in a new tab",
  },
  embed: {
    inputLabel: "Address to embed",
    placeholder: "https://www.youtube.com/watch?v=…",
    add: "Embed",
    unsupported:
      "This address can't be embedded. Allowed: YouTube, Vimeo, Google Docs, Sheets, Slides, Forms and Drive files, and Loom.",
    frameTitle: "Embedded content from {provider}",
    openOriginal: "Open the original",
  },
  files: {
    pending: "Security check pending. The file opens once the scan is complete.",
    tooLarge: "Files can be at most 25 MB.",
    uploadFailed: "The file couldn't be uploaded. Try again.",
  },
  readOnly: "You can read this but not change it.",
  a11y: {
    checkbox: "Done",
    slashList: "Blocks",
    toolbarControl: "Formatting option",
  },
};

export type EditorMessages = typeof editorEn;

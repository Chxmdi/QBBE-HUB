import type { CaptureT } from "./i18n";
import type { CaptureSuggestions } from "./suggest";
import type { FileChoice } from "./components/file-buttons";

/**
 * The filing buttons for one item, suggested first: the suggested action in
 * the best-matching project leads, then the other suggested projects, then
 * the same actions with no project. The first is the primary button.
 */
export function filingChoices(
  kind: "text" | "link" | "file" | "photo" | "email",
  suggestions: CaptureSuggestions,
  t: CaptureT,
): FileChoice[] {
  const canDocument = kind === "link" || kind === "file" || kind === "photo";
  const choices: Omit<FileChoice, "primary">[] = [];

  if (suggestions.contact) {
    choices.push({
      key: `interaction:${suggestions.contact.id}`,
      label: t("inbox.fileInteraction", { contact: suggestions.contact.full_name }),
      because: t("inbox.because.sender"),
      input: { as: "interaction", contactId: suggestions.contact.id },
    });
  }
  const order: ("task" | "document")[] =
    suggestions.action === "document" ? ["document", "task"] : canDocument ? ["task", "document"] : ["task"];
  for (const project of suggestions.projects) {
    for (const as of order) {
      choices.push({
        key: `${as}:${project.id}`,
        label: t(as === "task" ? "inbox.fileTask" : "inbox.fileDocument", { project: project.name }),
        because: t(`inbox.because.${project.reason}`),
        input: { as, projectId: project.id },
      });
    }
  }
  for (const as of order) {
    choices.push({
      key: `${as}:none`,
      label: t(as === "task" ? "inbox.fileTaskNoProject" : "inbox.fileDocumentNoProject"),
      because: null,
      input: { as },
    });
  }
  return choices.map((choice, index) => ({ ...choice, primary: index === 0 }));
}

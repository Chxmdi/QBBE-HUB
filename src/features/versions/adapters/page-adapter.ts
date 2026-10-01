import { editorDocumentAdapter } from "./editor-document-adapter";

/**
 * Pages as versioned objects (U9): the page row gives the title, its
 * editor_document gives the body. Every read and write runs as the signed-in
 * person, so app.can_page decides.
 */
export const pageContentAdapter = editorDocumentAdapter("page", "page");

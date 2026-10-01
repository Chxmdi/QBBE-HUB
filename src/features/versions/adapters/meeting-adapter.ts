import { editorDocumentAdapter } from "./editor-document-adapter";

/**
 * Meetings as versioned objects (U9): the meeting row gives the title, its
 * editor_document (the notes, V1-9) gives the body. The meeting's own rules
 * decide: attendees read, the organizer and managers write.
 */
export const meetingContentAdapter = editorDocumentAdapter("meeting", "meeting");

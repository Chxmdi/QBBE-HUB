/**
 * Wave 2 unit E3: its editor strings, read as t("units.e3.…"). Only E3 edits
 * this file and e3.fr-CA.ts (which must have exactly the same keys).
 */
export const e3EditorEn = {
  fallback: {
    message: "This block could not be shown. The rest of the page still works.",
    retry: "Try again",
    label: "{type} block could not be shown",
  },
  placeholders: {
    quote: "Type the words to quote",
    callout: "Write the note to highlight",
    toggleListItem: "Toggle title. Open it to add blocks inside",
  },
  code: {
    language: "Code language",
    plainText: "Plain text",
    other: "Other ({language})",
    copy: "Copy code",
    copied: "Code copied.",
    copyFailed: "Could not copy. Select the code and copy it with Ctrl+C.",
    empty: "Type or paste code here.",
    emptyReadOnly: "No code yet.",
  },
  media: {
    named: {
      image: "Image: {name}",
      video: "Video: {name}",
      audio: "Audio: {name}",
      file: "File: {name}",
    },
    unnamed: {
      image: "Image without a description",
      video: "Video",
      audio: "Audio file",
      file: "File",
    },
    caption: "Caption",
    captionPlaceholder: "Add a caption (optional)",
    alt: "Alt text",
    altPlaceholder: "Describe what the image shows",
    altMissing: "This image has no description. Add alt text so people who cannot see it know what it shows.",
    emptyHint: {
      image: "Upload an image or paste a link to one. Then describe it with alt text.",
      video: "Upload a video or paste a link to one.",
      audio: "Upload an audio file or paste a link to one.",
      file: "Upload a file or paste a link to one.",
    },
    emptyReadOnly: {
      image: "No image added yet.",
      video: "No video added yet.",
      audio: "No audio added yet.",
      file: "No file added yet.",
    },
    loading: "Loading…",
    uploading: "Uploading…",
    unsupported: "This address cannot be shown here. Use a file from the library or a secure link (https).",
    unavailable: "This file is not available. It may still be being checked for viruses, or it was removed.",
    failed: {
      image: "This image could not be loaded.",
      video: "This video could not be loaded.",
      audio: "This audio could not be loaded.",
      file: "This file could not be loaded.",
    },
    retry: "Try again",
    open: "Open {name}",
  },
  links: {
    bookmarkUnsupported: "This link cannot be opened here. Only secure links (https) are shown.",
    bookmarkEmpty: "No link added yet.",
    embedEmpty: "Nothing embedded yet.",
  },
  objects: {
    empty: "Nothing chosen yet.",
  },
};

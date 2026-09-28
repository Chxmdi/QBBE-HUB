/**
 * English text for knowledge screens (#141). Mounted at the top level of the
 * catalogue; this file owns only these namespaces: reports, documents, exports, textReader.
 */
export const knowledgeEn = {
  reports: {},
  documents: {},
  exports: {},
  textReader: {
    loading: "Getting ready to read the words in this file, so it can be found by search…",
    reading: "Reading the words in this file for search… {percent}%",
    found: "The words in this file were read. Search will find it by them.",
    notFound:
      "No words could be read in this file. It will be found by its title, description and tags.",
    failed:
      "The words in this file could not be read. It will be found by its title, description and tags.",
    timedOut: "Reading this file took too long. It will be found by its title, description and tags.",
    skipped: "Skipped. This file will be found by its title, description and tags.",
    skip: "Skip reading",
  },
};

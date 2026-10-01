-- Hardening (epic #18): the `documents` bucket refuses a file over 25 MB at
-- the storage layer, the same ceiling every upload form already applies on
-- the device (document library, editor files, quick capture). Until now the
-- device-side check was the only one, and a script talking to storage
-- directly could skip it. The receipts, form-files and signing-documents
-- buckets already carry this limit. `exports` is written only by the job
-- runner, never by a browser, and keeps no limit.
--
-- No MIME allow-list here: the library is meant to hold whatever an
-- organization works with (spreadsheets, slides, archives), and the virus
-- scan, not the file type, is what decides whether a file can be opened.
update storage.buckets
set file_size_limit = 26214400
where id = 'documents'
  and file_size_limit is null;

-- Receipt uploads left behind after a refused save (#142 follow-up).
--
-- The submit dialog uploads the photo first and then asks the server to save
-- the receipt; when the save is refused it removes the upload. Storage only
-- deletes objects the caller can also SELECT, and until now nobody could
-- select an unregistered receipt file, so that remove deleted nothing and the
-- file stayed in the bucket for good.
--
-- Let an uploader see their own files that are not yet registered as a
-- receipt, so they can clean them up. This gives nobody access to anyone
-- else's file, and a registered file is still readable only once scanned
-- clean ("receipts read clean registered").
create policy "receipts read own unregistered" on storage.objects
for select to authenticated using (
  bucket_id = 'receipts'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and not exists (
    select 1 from public.finance_receipt r where r.storage_path = storage.objects.name
  )
);

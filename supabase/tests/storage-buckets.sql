-- Storage bucket limits (hardening, epic #18). Rolled back.
--
-- Every bucket a browser can upload into carries a size ceiling at the
-- storage layer, so the device-side check is never the only one. The
-- `exports` bucket is written only by the job runner and is left alone.
begin;

do $$
declare
  v_bucket text;
  v_limit bigint;
begin
  foreach v_bucket in array array['documents', 'receipts', 'form-files', 'signing-documents'] loop
    select file_size_limit into v_limit from storage.buckets where id = v_bucket;
    if v_limit is distinct from 26214400 then
      raise exception 'bucket % has size limit %, expected 26214400 (25 MB)', v_bucket, v_limit;
    end if;
  end loop;

  if (select public from storage.buckets where id = 'documents') then
    raise exception 'the documents bucket must stay private';
  end if;
end;
$$;

rollback;

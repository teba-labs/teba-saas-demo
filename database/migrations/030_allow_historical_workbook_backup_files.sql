update storage.buckets
set allowed_mime_types = (
  select array_agg(distinct mime)
  from unnest(coalesce(allowed_mime_types, array[]::text[]) || array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv'
  ]) as mime
)
where id='tenant-backups';

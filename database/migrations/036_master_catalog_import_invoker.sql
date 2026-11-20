-- The import RPC does not need to bypass tenant RLS: direct authenticated grants and tenant policies protect every write.
alter function public.import_master_catalog_test(uuid,uuid) security invoker;

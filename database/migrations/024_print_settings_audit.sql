-- Add print settings to the metadata-only audit trail used by owner settings.
-- No data rewrite, no RLS changes, and no patient-portal changes.
drop trigger if exists trg_audit_print_settings on public.print_settings;
create trigger trg_audit_print_settings
after insert or update or delete on public.print_settings
for each row execute function private.capture_audit_log();

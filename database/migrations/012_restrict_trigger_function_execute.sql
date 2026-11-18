-- Taiba Smart Lab — harden trigger-only function execution.
-- The trigger still invokes this function automatically; browser roles must not
-- be able to call it directly. No table, row, or trigger is changed.
revoke all on function private.reject_report_version_mutation() from public, anon, authenticated;

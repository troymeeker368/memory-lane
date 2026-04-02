-- 0176_safe_unused_index_cleanup.sql
-- Drop only high-confidence redundant indexes that have stronger existing replacements.

-- 1. sales lead partner lookups
-- Superseded by idx_leads_partner_id_created_at_desc.
drop index if exists public.idx_leads_partner_id;

-- 2. member file chronology
-- Superseded by idx_member_files_member_id_uploaded_at_desc.
drop index if exists public.idx_member_files_member_uploaded_at;

-- 3. role permission lookups
-- Superseded by role_permissions_role_id_module_key_key.
drop index if exists public.idx_role_permissions_role_id;

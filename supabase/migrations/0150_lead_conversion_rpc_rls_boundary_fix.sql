-- Lead conversion writes member shell rows, including member_health_profiles,
-- through hardened service-only RLS policies. The public RPC wrappers must
-- therefore execute with definer privileges while remaining callable only by
-- authenticated app paths and service-role jobs.

alter function public.rpc_convert_lead_to_member(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  uuid,
  jsonb,
  timestamptz,
  date
) security definer;

revoke all on function public.rpc_convert_lead_to_member(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  uuid,
  jsonb,
  timestamptz,
  date
) from public;

grant execute on function public.rpc_convert_lead_to_member(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  uuid,
  jsonb,
  timestamptz,
  date
) to authenticated, service_role;

alter function public.rpc_create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  timestamptz,
  date
) security definer;

revoke all on function public.rpc_create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  timestamptz,
  date
) from public;

grant execute on function public.rpc_create_lead_with_member_conversion(
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  date,
  date,
  jsonb,
  timestamptz,
  date
) to authenticated, service_role;

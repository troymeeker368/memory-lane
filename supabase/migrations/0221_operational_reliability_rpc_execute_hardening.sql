-- Restrict operational reliability snapshot RPC to canonical privileged read boundary.
-- Runtime callers use service-role through lib/services/operational-reliability.ts.

revoke execute on function public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer) from authenticated;
grant execute on function public.rpc_get_operational_reliability_snapshot(integer, integer, integer, integer) to service_role;

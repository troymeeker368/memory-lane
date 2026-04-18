begin;

-- Privileged member-file listing must stay on a server-only service-role boundary.
revoke execute on function public.rpc_list_member_files(uuid) from authenticated;
grant execute on function public.rpc_list_member_files(uuid) to service_role;

-- Expiry reconciliation is a system workflow and should not be callable by arbitrary authenticated users.
revoke execute on function public.rpc_reconcile_expired_pof_requests(integer) from authenticated;
grant execute on function public.rpc_reconcile_expired_pof_requests(integer) to service_role;

commit;

alter table public.pof_requests
  add column if not exists pof_payload_json jsonb not null default '{}'::jsonb;

comment on column public.pof_requests.pof_payload_json is
  'Immutable physician order payload snapshot frozen at send/resend time for provider review and signed artifact rendering.';

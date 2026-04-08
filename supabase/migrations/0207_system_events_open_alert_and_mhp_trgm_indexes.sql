create extension if not exists pg_trgm;

create index if not exists idx_system_events_open_alert_lookup
  on public.system_events (entity_type, correlation_id, entity_id)
  where event_type = 'system_alert' and status = 'open';

create index if not exists idx_provider_directory_provider_name_trgm
  on public.provider_directory using gin (provider_name gin_trgm_ops);

create index if not exists idx_hospital_preference_directory_hospital_name_trgm
  on public.hospital_preference_directory using gin (hospital_name gin_trgm_ops);

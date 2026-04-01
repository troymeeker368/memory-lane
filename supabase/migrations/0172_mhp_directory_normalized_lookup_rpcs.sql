create or replace function public.rpc_lookup_provider_directory_normalized(
  p_provider_name text,
  p_practice_name text default null
)
returns table (
  id uuid,
  provider_name text,
  specialty text,
  specialty_other text,
  practice_name text,
  provider_phone text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_input as (
    select
      nullif(btrim(coalesce(p_provider_name, '')), '') as provider_name_trimmed,
      lower(btrim(coalesce(p_provider_name, ''))) as provider_name_normalized,
      lower(btrim(coalesce(p_practice_name, ''))) as practice_name_normalized
  )
  select
    directory.id,
    directory.provider_name,
    directory.specialty,
    directory.specialty_other,
    directory.practice_name,
    directory.provider_phone
  from public.provider_directory as directory
  cross join normalized_input as input
  where input.provider_name_trimmed is not null
    and lower(btrim(directory.provider_name)) = input.provider_name_normalized
    and lower(btrim(coalesce(directory.practice_name, ''))) = input.practice_name_normalized;
$$;

grant execute on function public.rpc_lookup_provider_directory_normalized(
  text,
  text
) to authenticated, service_role;

create or replace function public.rpc_lookup_hospital_preference_directory_normalized(
  p_hospital_name text
)
returns table (
  id uuid,
  hospital_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with normalized_input as (
    select
      nullif(btrim(coalesce(p_hospital_name, '')), '') as hospital_name_trimmed,
      lower(btrim(coalesce(p_hospital_name, ''))) as hospital_name_normalized
  )
  select
    directory.id,
    directory.hospital_name
  from public.hospital_preference_directory as directory
  cross join normalized_input as input
  where input.hospital_name_trimmed is not null
    and lower(btrim(directory.hospital_name)) = input.hospital_name_normalized;
$$;

grant execute on function public.rpc_lookup_hospital_preference_directory_normalized(
  text
) to authenticated, service_role;

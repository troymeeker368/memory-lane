create extension if not exists pg_trgm;

create or replace function public.rpc_list_mar_member_options()
returns table (
  member_id uuid,
  member_name text,
  member_dob date,
  member_identifier text,
  member_status text,
  active_for_workflow boolean,
  eligible_for_report boolean
)
language sql
stable
set search_path = public
as $$
  with reportable_members as (
    select pm.member_id
    from public.pof_medications pm
    where pm.given_at_center = true
      and pm.member_id is not null
    union
    select ma.member_id
    from public.mar_administrations ma
    where ma.member_id is not null
    union
    select mo.member_id
    from public.medication_orders mo
    where mo.order_type = 'prn'
      and mo.member_id is not null
    union
    select mal.member_id
    from public.med_administration_logs mal
    where mal.admin_type = 'prn'
      and mal.member_id is not null
  )
  select
    m.id as member_id,
    m.display_name as member_name,
    m.dob as member_dob,
    nullif(trim(m.qr_code), '') as member_identifier,
    nullif(trim(m.status), '') as member_status,
    (coalesce(m.status, '') = 'active') as active_for_workflow,
    (rm.member_id is not null) as eligible_for_report
  from public.members m
  left join reportable_members rm on rm.member_id = m.id
  where coalesce(m.status, '') = 'active'
     or rm.member_id is not null
  order by m.display_name asc, m.id asc;
$$;

grant execute on function public.rpc_list_mar_member_options() to authenticated, service_role;

create or replace function public.rpc_get_progress_note_tracker_summary(
  p_member_id uuid default null,
  p_query_pattern text default null
)
returns table (
  total bigint,
  overdue bigint,
  due_today bigint,
  due_soon bigint,
  upcoming bigint,
  data_issues bigint
)
language sql
stable
set search_path = public
as $$
  with latest_signed as (
    select distinct on (pn.member_id)
      pn.member_id,
      pn.id as latest_signed_note_id,
      timezone('America/New_York', pn.signed_at)::date as last_signed_progress_note_date
    from public.progress_notes pn
    where pn.status = 'signed'
      and pn.signed_at is not null
    order by pn.member_id, pn.signed_at desc, pn.updated_at desc, pn.id desc
  ),
  latest_draft as (
    select distinct on (pn.member_id)
      pn.member_id,
      pn.id as latest_draft_id
    from public.progress_notes pn
    where pn.status = 'draft'
    order by pn.member_id, pn.updated_at desc, pn.id desc
  ),
  tracker_base as (
    select
      m.id as member_id,
      m.display_name as member_name,
      nullif(trim(m.status), '') as member_status,
      m.enrollment_date,
      ls.last_signed_progress_note_date,
      ld.latest_draft_id,
      ls.latest_signed_note_id,
      coalesce(ls.last_signed_progress_note_date, m.enrollment_date) as anchor_date,
      timezone('America/New_York', now())::date as today_eastern
    from public.members m
    left join latest_signed ls on ls.member_id = m.id
    left join latest_draft ld on ld.member_id = m.id
    where (p_member_id is null or m.id = p_member_id)
      and (
        p_query_pattern is null
        or m.display_name ilike p_query_pattern
      )
  ),
  tracker as (
    select
      member_id,
      case
        when anchor_date is null then 'data_issue'
        when anchor_date + 90 < today_eastern then 'overdue'
        when anchor_date + 90 = today_eastern then 'due'
        when anchor_date + 90 <= today_eastern + 14 then 'due_soon'
        else 'upcoming'
      end as compliance_status
    from tracker_base
  )
  select
    count(*)::bigint as total,
    count(*) filter (where compliance_status = 'overdue')::bigint as overdue,
    count(*) filter (where compliance_status = 'due')::bigint as due_today,
    count(*) filter (where compliance_status = 'due_soon')::bigint as due_soon,
    count(*) filter (where compliance_status = 'upcoming')::bigint as upcoming,
    count(*) filter (where compliance_status = 'data_issue')::bigint as data_issues
  from tracker;
$$;

grant execute on function public.rpc_get_progress_note_tracker_summary(uuid, text) to authenticated, service_role;

create or replace function public.rpc_get_progress_note_tracker_page(
  p_status_filter text default 'All',
  p_member_id uuid default null,
  p_query_pattern text default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns table (
  member_id uuid,
  member_name text,
  member_status text,
  enrollment_date date,
  last_signed_progress_note_date date,
  next_progress_note_due_date date,
  days_until_due integer,
  compliance_status text,
  has_draft_in_progress boolean,
  latest_draft_id uuid,
  latest_signed_note_id uuid,
  data_issue text,
  total_rows bigint
)
language sql
stable
set search_path = public
as $$
  with latest_signed as (
    select distinct on (pn.member_id)
      pn.member_id,
      pn.id as latest_signed_note_id,
      timezone('America/New_York', pn.signed_at)::date as last_signed_progress_note_date
    from public.progress_notes pn
    where pn.status = 'signed'
      and pn.signed_at is not null
    order by pn.member_id, pn.signed_at desc, pn.updated_at desc, pn.id desc
  ),
  latest_draft as (
    select distinct on (pn.member_id)
      pn.member_id,
      pn.id as latest_draft_id
    from public.progress_notes pn
    where pn.status = 'draft'
    order by pn.member_id, pn.updated_at desc, pn.id desc
  ),
  tracker_base as (
    select
      m.id as member_id,
      m.display_name as member_name,
      nullif(trim(m.status), '') as member_status,
      m.enrollment_date,
      ls.last_signed_progress_note_date,
      ld.latest_draft_id,
      ls.latest_signed_note_id,
      coalesce(ls.last_signed_progress_note_date, m.enrollment_date) as anchor_date,
      timezone('America/New_York', now())::date as today_eastern
    from public.members m
    left join latest_signed ls on ls.member_id = m.id
    left join latest_draft ld on ld.member_id = m.id
    where (p_member_id is null or m.id = p_member_id)
      and (
        p_query_pattern is null
        or m.display_name ilike p_query_pattern
      )
  ),
  tracker as (
    select
      member_id,
      member_name,
      member_status,
      enrollment_date,
      last_signed_progress_note_date,
      case
        when anchor_date is null then null
        else anchor_date + 90
      end as next_progress_note_due_date,
      case
        when anchor_date is null then null
        else (anchor_date + 90) - today_eastern
      end as days_until_due,
      case
        when anchor_date is null then 'data_issue'
        when anchor_date + 90 < today_eastern then 'overdue'
        when anchor_date + 90 = today_eastern then 'due'
        when anchor_date + 90 <= today_eastern + 14 then 'due_soon'
        else 'upcoming'
      end as compliance_status,
      (latest_draft_id is not null) as has_draft_in_progress,
      latest_draft_id,
      latest_signed_note_id,
      case
        when anchor_date is null then 'Enrollment date missing'
        else null
      end as data_issue
    from tracker_base
  ),
  filtered as (
    select
      t.*,
      case t.compliance_status
        when 'data_issue' then 0
        when 'overdue' then 1
        when 'due' then 2
        when 'due_soon' then 3
        else 4
      end as status_rank
    from tracker t
    where case
      when p_status_filter = 'Overdue' then t.compliance_status = 'overdue'
      when p_status_filter = 'Due Today' then t.compliance_status = 'due'
      when p_status_filter = 'Due Soon' then t.compliance_status = 'due_soon'
      when p_status_filter = 'Completed/Upcoming' then t.compliance_status = 'upcoming'
      else true
    end
  )
  select
    f.member_id,
    f.member_name,
    f.member_status,
    f.enrollment_date,
    f.last_signed_progress_note_date,
    f.next_progress_note_due_date,
    f.days_until_due,
    f.compliance_status,
    f.has_draft_in_progress,
    f.latest_draft_id,
    f.latest_signed_note_id,
    f.data_issue,
    count(*) over()::bigint as total_rows
  from filtered f
  order by f.status_rank asc, f.next_progress_note_due_date asc nulls last, f.member_name asc, f.member_id asc
  offset greatest(coalesce(p_page, 1), 1)::integer - 1
         * greatest(coalesce(p_page_size, 25), 1)::integer
  limit greatest(coalesce(p_page_size, 25), 1)::integer;
$$;

grant execute on function public.rpc_get_progress_note_tracker_page(text, uuid, text, integer, integer) to authenticated, service_role;

create or replace function public.rpc_get_health_dashboard_care_alerts(
  p_limit integer default 12
)
returns table (
  member_id uuid,
  member_name text,
  flags text[],
  summary text
)
language sql
stable
set search_path = public
as $$
  select
    m.id as member_id,
    m.display_name as member_name,
    array_remove(
      array[
        case
          when nullif(
            trim(
              concat_ws(
                ' ',
                nullif(trim(coalesce(mcc.food_allergies, '')), ''),
                nullif(trim(coalesce(mcc.medication_allergies, '')), ''),
                nullif(trim(coalesce(mcc.environmental_allergies, '')), '')
              )
            ),
            ''
          ) is not null then 'Allergies'
          else null
        end,
        case
          when lower(trim(coalesce(mcc.diet_type, mhp.diet_type, ''))) <> ''
               and lower(trim(coalesce(mcc.diet_type, mhp.diet_type, ''))) <> 'regular'
            then 'Special diet'
          when nullif(
            trim(
              concat_ws(
                ' ',
                nullif(trim(coalesce(mcc.dietary_preferences_restrictions, '')), ''),
                nullif(trim(coalesce(mhp.dietary_restrictions, '')), '')
              )
            ),
            ''
          ) is not null then 'Special diet'
          else null
        end,
        case
          when trim(coalesce(mcc.code_status, mhp.code_status, m.code_status, '')) = 'DNR' then 'DNR'
          else null
        end,
        case
          when nullif(trim(coalesce(mhp.important_alerts, '')), '') is not null
            or nullif(trim(coalesce(mcc.command_center_notes, '')), '') is not null
            then 'Care alert'
          else null
        end,
        case
          when nullif(trim(coalesce(mhp.cognitive_behavior_comments, '')), '') is not null then 'Behavior notes'
          else null
        end
      ],
      null
    ) as flags,
    coalesce(
      nullif(
        trim(
          concat_ws(
            ' ',
            nullif(trim(coalesce(mhp.important_alerts, '')), ''),
            nullif(trim(coalesce(mcc.command_center_notes, '')), ''),
            nullif(
              trim(
                concat_ws(
                  ' ',
                  nullif(trim(coalesce(mcc.dietary_preferences_restrictions, '')), ''),
                  nullif(trim(coalesce(mhp.dietary_restrictions, '')), '')
                )
              ),
              ''
            ),
            nullif(trim(coalesce(mhp.cognitive_behavior_comments, '')), '')
          )
        ),
        ''
      ),
      '-'
    ) as summary
  from public.members m
  left join public.member_command_centers mcc on mcc.member_id = m.id
  left join public.member_health_profiles mhp on mhp.member_id = m.id
  where coalesce(m.status, '') = 'active'
    and array_length(
      array_remove(
        array[
          case
            when nullif(
              trim(
                concat_ws(
                  ' ',
                  nullif(trim(coalesce(mcc.food_allergies, '')), ''),
                  nullif(trim(coalesce(mcc.medication_allergies, '')), ''),
                  nullif(trim(coalesce(mcc.environmental_allergies, '')), '')
                )
              ),
              ''
            ) is not null then 'Allergies'
            else null
          end,
          case
            when lower(trim(coalesce(mcc.diet_type, mhp.diet_type, ''))) <> ''
                 and lower(trim(coalesce(mcc.diet_type, mhp.diet_type, ''))) <> 'regular'
              then 'Special diet'
            when nullif(
              trim(
                concat_ws(
                  ' ',
                  nullif(trim(coalesce(mcc.dietary_preferences_restrictions, '')), ''),
                  nullif(trim(coalesce(mhp.dietary_restrictions, '')), '')
                )
              ),
              ''
            ) is not null then 'Special diet'
            else null
          end,
          case
            when trim(coalesce(mcc.code_status, mhp.code_status, m.code_status, '')) = 'DNR' then 'DNR'
            else null
          end,
          case
            when nullif(trim(coalesce(mhp.important_alerts, '')), '') is not null
              or nullif(trim(coalesce(mcc.command_center_notes, '')), '') is not null
              then 'Care alert'
            else null
          end,
          case
            when nullif(trim(coalesce(mhp.cognitive_behavior_comments, '')), '') is not null then 'Behavior notes'
            else null
          end
        ],
        null
      ),
      1
    ) > 0
  order by m.display_name asc, m.id asc
  limit greatest(coalesce(p_limit, 12), 1)::integer;
$$;

grant execute on function public.rpc_get_health_dashboard_care_alerts(integer) to authenticated, service_role;

create index if not exists idx_daily_activity_logs_staff_user_id_created_at_desc
  on public.daily_activity_logs (staff_user_id, created_at desc);

create index if not exists idx_toilet_logs_staff_user_id_event_at_desc
  on public.toilet_logs (staff_user_id, event_at desc);

create index if not exists idx_shower_logs_staff_user_id_event_at_desc
  on public.shower_logs (staff_user_id, event_at desc);

create index if not exists idx_transportation_logs_staff_user_id_service_date_desc
  on public.transportation_logs (staff_user_id, service_date desc);

create index if not exists idx_intake_assessments_completed_by_user_id_created_at_desc
  on public.intake_assessments (completed_by_user_id, created_at desc);

create index if not exists idx_lead_activities_completed_by_user_id_activity_at_desc
  on public.lead_activities (completed_by_user_id, activity_at desc);

create index if not exists idx_partner_activities_activity_at_desc
  on public.partner_activities (activity_at desc);

create index if not exists idx_ancillary_charge_logs_service_date_desc
  on public.ancillary_charge_logs (service_date desc);

create index if not exists idx_medication_orders_order_type_status_medication_name
  on public.medication_orders (order_type, status, medication_name);

create index if not exists idx_med_administration_logs_admin_type_admin_datetime_desc
  on public.med_administration_logs (admin_type, admin_datetime desc);

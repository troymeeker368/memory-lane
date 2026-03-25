create or replace function public.normalize_enrollment_packet_recreation_interests(raw jsonb)
returns jsonb
language sql
immutable
as $$
with object_shape as (
  select jsonb_build_object(
    'Social', coalesce(raw->'Social', '[]'::jsonb),
    'Cognitive', coalesce(raw->'Cognitive', '[]'::jsonb),
    'Physical', coalesce(raw->'Physical', '[]'::jsonb),
    'Creative', coalesce(raw->'Creative', '[]'::jsonb),
    'Sensory', coalesce(raw->'Sensory', '[]'::jsonb),
    'Spiritual', coalesce(raw->'Spiritual', '[]'::jsonb)
  ) as payload
),
legacy_values as (
  select lower(trim(value)) as value
  from jsonb_array_elements_text(case when jsonb_typeof(raw) = 'array' then raw else '[]'::jsonb end) as value
),
mapped as (
  select
    case
      when value like 'social - %' then 'Social'
      when value like 'cognitive - %' then 'Cognitive'
      when value like 'physical - %' then 'Physical'
      when value = 'expressive - meditation' then 'Spiritual'
      when value in ('expressive - gardening', 'expressive - singing') then 'Sensory'
      when value like 'expressive - %' then 'Creative'
      else null
    end as category,
    case
      when value = 'social - chess / checkers' then 'Board Games'
      when value = 'physical - playing pool' then 'Board Games'
      when value in ('physical - mini golf', 'physical - frisbee toss') then 'Fitness / Exercise'
      when value = 'expressive - woodworking' then 'Arts & Crafts'
      when value = 'expressive - drama club' then 'Arts & Crafts'
      when value = 'expressive - gardening' then 'Gardening'
      when value = 'expressive - singing' then 'Music Listening'
      when value = 'expressive - meditation' then 'Meditation'
      else trim(regexp_replace(value, '^[^-]+-\s*', ''))
    end as option
  from legacy_values
),
legacy_shape as (
  select jsonb_build_object(
    'Social', coalesce(jsonb_agg(option) filter (where category = 'Social'), '[]'::jsonb),
    'Cognitive', coalesce(jsonb_agg(option) filter (where category = 'Cognitive'), '[]'::jsonb),
    'Physical', coalesce(jsonb_agg(option) filter (where category = 'Physical'), '[]'::jsonb),
    'Creative', coalesce(jsonb_agg(option) filter (where category = 'Creative'), '[]'::jsonb),
    'Sensory', coalesce(jsonb_agg(option) filter (where category = 'Sensory'), '[]'::jsonb),
    'Spiritual', coalesce(jsonb_agg(option) filter (where category = 'Spiritual'), '[]'::jsonb)
  ) as payload
  from mapped
)
select
  case
    when jsonb_typeof(raw) = 'object' then (select payload from object_shape)
    else (select payload from legacy_shape)
  end;
$$;

with normalized_payloads as (
  select
    epf.id,
    (
      (
        coalesce(epf.intake_payload, '{}'::jsonb)
        - 'membershipGuarantorSignatureRole'
        - 'exhibitAGuarantorSignatureDate'
        - 'exhibitAGuarantorSignatureRole'
        - 'membershipMemberSignatureName'
        - 'membershipMemberSignatureDate'
        - 'membershipMemberSignatureRole'
        - 'exhibitAMemberSignatureName'
        - 'exhibitAMemberSignatureDate'
        - 'exhibitAMemberSignatureRole'
        - 'privacyPracticesAcknowledged'
        - 'statementOfRightsAcknowledged'
        - 'photoConsentAcknowledged'
        - 'photoConsentAcknowledgmentName'
        - 'photoConsentMemberName'
        - 'ancillaryChargesAcknowledged'
        - 'welcomeChecklistAcknowledgedName'
        - 'welcomeChecklistAcknowledgedDate'
        - 'recreationalInterests'
      )
      || jsonb_build_object(
        'recreationInterests',
        public.normalize_enrollment_packet_recreation_interests(
          coalesce(
            epf.intake_payload->'recreationInterests',
            epf.intake_payload->'recreationalInterests',
            '[]'::jsonb
          )
        )
      )
      || case
        when lower(trim(coalesce(epf.intake_payload->>'photoConsentChoice', ''))) in ('i do permit', 'do permit')
          then jsonb_build_object('photoConsentChoice', 'Do Permit')
        when lower(trim(coalesce(epf.intake_payload->>'photoConsentChoice', ''))) in ('i do not permit', 'do not permit')
          then jsonb_build_object('photoConsentChoice', 'Do Not Permit')
        else '{}'::jsonb
      end
      || case
        when coalesce(nullif(trim(epf.intake_payload->>'membershipGuarantorSignatureDate'), ''), '') = ''
          then jsonb_build_object(
            'membershipGuarantorSignatureDate',
            coalesce(
              nullif(trim(epf.intake_payload->>'guarantorSignatureDate'), ''),
              to_char(coalesce(req.completed_at, req.updated_at)::date, 'YYYY-MM-DD')
            )
          )
        else '{}'::jsonb
      end
      || case
        when coalesce(nullif(trim(epf.intake_payload->>'exhibitAGuarantorSignatureName'), ''), '') = ''
             and coalesce(nullif(trim(epf.intake_payload->>'membershipGuarantorSignatureName'), ''), '') <> ''
          then jsonb_build_object(
            'exhibitAGuarantorSignatureName',
            epf.intake_payload->>'membershipGuarantorSignatureName'
          )
        else '{}'::jsonb
      end
    ) as payload
  from public.enrollment_packet_fields epf
  inner join public.enrollment_packet_requests req on req.id = epf.packet_id
)
update public.enrollment_packet_fields as epf
set intake_payload = normalized.payload
from normalized_payloads as normalized
where normalized.id = epf.id;

drop function public.normalize_enrollment_packet_recreation_interests(jsonb);

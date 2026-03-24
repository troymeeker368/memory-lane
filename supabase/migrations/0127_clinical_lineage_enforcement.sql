update public.intake_assessment_signatures sig
set member_id = ia.member_id
from public.intake_assessments ia
where ia.id = sig.assessment_id
  and sig.member_id is distinct from ia.member_id;

update public.intake_post_sign_follow_up_queue q
set member_id = ia.member_id
from public.intake_assessments ia
where ia.id = q.assessment_id
  and q.member_id is distinct from ia.member_id;

update public.pof_medications pm
set member_id = po.member_id
from public.physician_orders po
where po.id = pm.physician_order_id
  and pm.member_id is distinct from po.member_id;

update public.mar_schedules ms
set member_id = pm.member_id
from public.pof_medications pm
where pm.id = ms.pof_medication_id
  and ms.member_id is distinct from pm.member_id;

update public.mar_administrations ma
set
  member_id = ms.member_id,
  pof_medication_id = ms.pof_medication_id
from public.mar_schedules ms
where ms.id = ma.mar_schedule_id
  and (
    ma.member_id is distinct from ms.member_id
    or ma.pof_medication_id is distinct from ms.pof_medication_id
  );

update public.mar_administrations ma
set member_id = pm.member_id
from public.pof_medications pm
where ma.mar_schedule_id is null
  and pm.id = ma.pof_medication_id
  and ma.member_id is distinct from pm.member_id;

do $$
declare
  v_count bigint;
begin
  select count(*)
  into v_count
  from public.intake_assessment_signatures sig
  join public.intake_assessments ia on ia.id = sig.assessment_id
  where sig.member_id <> ia.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce intake_assessment_signatures lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.intake_post_sign_follow_up_queue q
  join public.intake_assessments ia on ia.id = q.assessment_id
  where q.member_id <> ia.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce intake_post_sign_follow_up_queue lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.pof_medications pm
  join public.physician_orders po on po.id = pm.physician_order_id
  where pm.member_id <> po.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce pof_medications lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.mar_schedules ms
  join public.pof_medications pm on pm.id = ms.pof_medication_id
  where ms.member_id <> pm.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce mar_schedules lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.mar_administrations ma
  join public.pof_medications pm on pm.id = ma.pof_medication_id
  where ma.member_id <> pm.member_id;
  if v_count > 0 then
    raise exception 'Cannot enforce mar_administrations medication lineage: % mismatched rows found.', v_count;
  end if;

  select count(*)
  into v_count
  from public.mar_administrations ma
  join public.mar_schedules ms on ms.id = ma.mar_schedule_id
  where ma.mar_schedule_id is not null
    and (
      ma.member_id <> ms.member_id
      or ma.pof_medication_id <> ms.pof_medication_id
    );
  if v_count > 0 then
    raise exception 'Cannot enforce mar_administrations schedule lineage: % mismatched rows found.', v_count;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'intake_assessments_id_member_unique'
  ) then
    alter table public.intake_assessments
      add constraint intake_assessments_id_member_unique unique (id, member_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'physician_orders_id_member_unique'
  ) then
    alter table public.physician_orders
      add constraint physician_orders_id_member_unique unique (id, member_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pof_medications_id_member_unique'
  ) then
    alter table public.pof_medications
      add constraint pof_medications_id_member_unique unique (id, member_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mar_schedules_id_medication_member_unique'
  ) then
    alter table public.mar_schedules
      add constraint mar_schedules_id_medication_member_unique unique (id, pof_medication_id, member_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'intake_assessment_signatures_assessment_member_fkey'
  ) then
    alter table public.intake_assessment_signatures
      add constraint intake_assessment_signatures_assessment_member_fkey
      foreign key (assessment_id, member_id)
      references public.intake_assessments(id, member_id)
      on delete cascade
      not valid;
    alter table public.intake_assessment_signatures
      validate constraint intake_assessment_signatures_assessment_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'intake_post_sign_follow_up_queue_assessment_member_fkey'
  ) then
    alter table public.intake_post_sign_follow_up_queue
      add constraint intake_post_sign_follow_up_queue_assessment_member_fkey
      foreign key (assessment_id, member_id)
      references public.intake_assessments(id, member_id)
      on delete cascade
      not valid;
    alter table public.intake_post_sign_follow_up_queue
      validate constraint intake_post_sign_follow_up_queue_assessment_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pof_medications_physician_order_member_fkey'
  ) then
    alter table public.pof_medications
      add constraint pof_medications_physician_order_member_fkey
      foreign key (physician_order_id, member_id)
      references public.physician_orders(id, member_id)
      on delete cascade
      not valid;
    alter table public.pof_medications
      validate constraint pof_medications_physician_order_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mar_schedules_pof_medication_member_fkey'
  ) then
    alter table public.mar_schedules
      add constraint mar_schedules_pof_medication_member_fkey
      foreign key (pof_medication_id, member_id)
      references public.pof_medications(id, member_id)
      on delete restrict
      not valid;
    alter table public.mar_schedules
      validate constraint mar_schedules_pof_medication_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mar_administrations_medication_member_fkey'
  ) then
    alter table public.mar_administrations
      add constraint mar_administrations_medication_member_fkey
      foreign key (pof_medication_id, member_id)
      references public.pof_medications(id, member_id)
      on delete restrict
      not valid;
    alter table public.mar_administrations
      validate constraint mar_administrations_medication_member_fkey;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mar_administrations_schedule_member_lineage_fkey'
  ) then
    alter table public.mar_administrations
      add constraint mar_administrations_schedule_member_lineage_fkey
      foreign key (mar_schedule_id, pof_medication_id, member_id)
      references public.mar_schedules(id, pof_medication_id, member_id)
      not valid;
    alter table public.mar_administrations
      validate constraint mar_administrations_schedule_member_lineage_fkey;
  end if;
end
$$;

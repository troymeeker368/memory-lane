-- Harden operations late-pickup settings at the database layer so
-- invalid values cannot bypass runtime validation.
-- Also keep the canonical "Late Pickup" category price aligned with
-- the configured first-window fee.

insert into public.operations_settings (
  id,
  bus_numbers,
  makeup_policy,
  late_pickup_grace_start_time,
  late_pickup_first_window_minutes,
  late_pickup_first_window_fee_cents,
  late_pickup_additional_per_minute_cents,
  late_pickup_additional_minutes_cap
)
values (
  'default',
  array['1', '2', '3']::text[],
  'rolling_30_day_expiration',
  '16:30',
  15,
  2500,
  200,
  30
)
on conflict (id) do nothing;

update public.operations_settings
set
  late_pickup_grace_start_time = '16:30',
  late_pickup_first_window_minutes = least(greatest(coalesce(late_pickup_first_window_minutes, 15), 1), 180),
  late_pickup_first_window_fee_cents = least(greatest(coalesce(late_pickup_first_window_fee_cents, 2500), 0), 999900),
  late_pickup_additional_per_minute_cents = least(greatest(coalesce(late_pickup_additional_per_minute_cents, 200), 0), 99900),
  late_pickup_additional_minutes_cap = least(greatest(coalesce(late_pickup_additional_minutes_cap, 30), 0), 240),
  updated_at = now()
where late_pickup_grace_start_time !~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
   or late_pickup_first_window_minutes is null
   or late_pickup_first_window_minutes < 1
   or late_pickup_first_window_minutes > 180
   or late_pickup_first_window_fee_cents is null
   or late_pickup_first_window_fee_cents < 0
   or late_pickup_first_window_fee_cents > 999900
   or late_pickup_additional_per_minute_cents is null
   or late_pickup_additional_per_minute_cents < 0
   or late_pickup_additional_per_minute_cents > 99900
   or late_pickup_additional_minutes_cap is null
   or late_pickup_additional_minutes_cap < 0
   or late_pickup_additional_minutes_cap > 240;

alter table public.operations_settings
  drop constraint if exists operations_settings_late_pickup_grace_start_time_format_check;

alter table public.operations_settings
  add constraint operations_settings_late_pickup_grace_start_time_format_check
  check (late_pickup_grace_start_time ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
  not valid;

alter table public.operations_settings
  drop constraint if exists operations_settings_late_pickup_first_window_minutes_range_check;

alter table public.operations_settings
  add constraint operations_settings_late_pickup_first_window_minutes_range_check
  check (late_pickup_first_window_minutes between 1 and 180)
  not valid;

alter table public.operations_settings
  drop constraint if exists operations_settings_late_pickup_first_window_fee_cents_range_check;

alter table public.operations_settings
  add constraint operations_settings_late_pickup_first_window_fee_cents_range_check
  check (late_pickup_first_window_fee_cents between 0 and 999900)
  not valid;

alter table public.operations_settings
  drop constraint if exists operations_settings_late_pickup_additional_per_minute_cents_range_check;

alter table public.operations_settings
  add constraint operations_settings_late_pickup_additional_per_minute_cents_range_check
  check (late_pickup_additional_per_minute_cents between 0 and 99900)
  not valid;

alter table public.operations_settings
  drop constraint if exists operations_settings_late_pickup_additional_minutes_cap_range_check;

alter table public.operations_settings
  add constraint operations_settings_late_pickup_additional_minutes_cap_range_check
  check (late_pickup_additional_minutes_cap between 0 and 240)
  not valid;

alter table public.operations_settings
  validate constraint operations_settings_late_pickup_grace_start_time_format_check;

alter table public.operations_settings
  validate constraint operations_settings_late_pickup_first_window_minutes_range_check;

alter table public.operations_settings
  validate constraint operations_settings_late_pickup_first_window_fee_cents_range_check;

alter table public.operations_settings
  validate constraint operations_settings_late_pickup_additional_per_minute_cents_range_check;

alter table public.operations_settings
  validate constraint operations_settings_late_pickup_additional_minutes_cap_range_check;

alter table public.ancillary_charge_categories
  drop constraint if exists ancillary_charge_categories_price_cents_non_negative_check;

alter table public.ancillary_charge_categories
  add constraint ancillary_charge_categories_price_cents_non_negative_check
  check (price_cents >= 0)
  not valid;

alter table public.ancillary_charge_categories
  validate constraint ancillary_charge_categories_price_cents_non_negative_check;

update public.ancillary_charge_categories as categories
set
  price_cents = settings.late_pickup_first_window_fee_cents
from public.operations_settings as settings
where settings.id = 'default'
  and lower(categories.name) = 'late pickup'
  and categories.price_cents <> settings.late_pickup_first_window_fee_cents;

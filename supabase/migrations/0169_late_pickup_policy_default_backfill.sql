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
on conflict (id) do update
set late_pickup_grace_start_time = excluded.late_pickup_grace_start_time,
    late_pickup_first_window_minutes = excluded.late_pickup_first_window_minutes,
    late_pickup_first_window_fee_cents = excluded.late_pickup_first_window_fee_cents,
    late_pickup_additional_per_minute_cents = excluded.late_pickup_additional_per_minute_cents,
    late_pickup_additional_minutes_cap = excluded.late_pickup_additional_minutes_cap,
    updated_at = now();

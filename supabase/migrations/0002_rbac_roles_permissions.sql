create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  rank integer not null,
  is_system_role boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles(id) on delete cascade,
  module_key text not null check (module_key in ('documentation', 'operations', 'reports', 'time-hr', 'sales-activities', 'health-unit', 'admin-reports', 'user-management')),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (role_id, module_key)
);

create table if not exists public.user_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null check (module_key in ('documentation', 'operations', 'reports', 'time-hr', 'sales-activities', 'health-unit', 'admin-reports', 'user-management')),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, module_key)
);

alter table public.profiles
  add column if not exists role_id uuid references public.roles(id),
  add column if not exists has_custom_permissions boolean not null default false;

drop trigger if exists trg_roles_updated on public.roles;
create trigger trg_roles_updated before update on public.roles
for each row execute function public.set_updated_at();

drop trigger if exists trg_role_permissions_updated on public.role_permissions;
create trigger trg_role_permissions_updated before update on public.role_permissions
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_permissions_updated on public.user_permissions;
create trigger trg_user_permissions_updated before update on public.user_permissions
for each row execute function public.set_updated_at();

create index if not exists idx_role_permissions_role_id on public.role_permissions(role_id);
create index if not exists idx_user_permissions_user_id on public.user_permissions(user_id);
create index if not exists idx_profiles_role_id on public.profiles(role_id);


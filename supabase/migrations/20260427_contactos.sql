-- Contactos: agenda de destinatarios de transferencias por cliente.
-- Permite envío recurrente sin reingresar CVU/Alias y soporta favoritos.

create table if not exists public.contactos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  nombre text not null,
  cvu text,
  alias text,
  cuit text,
  titular text,
  banco text,
  email text,
  telefono text,
  favorito boolean not null default false,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contactos_cvu_format check (cvu is null or cvu ~ '^[0-9]{22}$'),
  constraint contactos_cuit_format check (cuit is null or cuit ~ '^[0-9]{11}$'),
  constraint contactos_at_least_one_destination check (cvu is not null or alias is not null)
);

create index if not exists contactos_cliente_id_idx on public.contactos(cliente_id);
create index if not exists contactos_cliente_favorito_idx
  on public.contactos(cliente_id) where favorito = true;
create unique index if not exists contactos_cliente_cvu_unique
  on public.contactos(cliente_id, cvu) where cvu is not null;
create unique index if not exists contactos_cliente_alias_unique
  on public.contactos(cliente_id, alias) where alias is not null;

alter table public.contactos enable row level security;

drop policy if exists contactos_owner_select on public.contactos;
create policy contactos_owner_select on public.contactos
  for select to authenticated
  using (
    cliente_id in (select id from public.clientes where auth_user_id = auth.uid())
  );

drop policy if exists contactos_owner_insert on public.contactos;
create policy contactos_owner_insert on public.contactos
  for insert to authenticated
  with check (
    cliente_id in (select id from public.clientes where auth_user_id = auth.uid())
  );

drop policy if exists contactos_owner_update on public.contactos;
create policy contactos_owner_update on public.contactos
  for update to authenticated
  using (
    cliente_id in (select id from public.clientes where auth_user_id = auth.uid())
  )
  with check (
    cliente_id in (select id from public.clientes where auth_user_id = auth.uid())
  );

drop policy if exists contactos_owner_delete on public.contactos;
create policy contactos_owner_delete on public.contactos
  for delete to authenticated
  using (
    cliente_id in (select id from public.clientes where auth_user_id = auth.uid())
  );

create or replace function public.set_updated_at_contactos()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_contactos_updated_at on public.contactos;
create trigger trg_contactos_updated_at
  before update on public.contactos
  for each row execute function public.set_updated_at_contactos();

comment on table public.contactos is
  'Agenda de destinatarios de transferencias por cliente. Permite envío recurrente sin reingresar CVU/Alias.';

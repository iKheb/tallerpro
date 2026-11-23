-- ============================================================================
-- TallerPro · Sincronización en la nube (Supabase)
-- Pega TODO este script en Supabase → SQL Editor → New query → Run.
-- Se puede ejecutar más de una vez sin problema.
-- ============================================================================

-- Contador global de cambios (cada fila guardada recibe un número creciente).
create sequence if not exists public.tallerpro_seq;

-- Una sola tabla para todos los registros de la app (clientes, gastos,
-- inventario, movimientos, actividad y datos del negocio), separados por cuenta.
create table if not exists public.tallerpro_rows (
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  tbl        text   not null,
  id         text   not null,
  data       jsonb  not null,
  updated_at bigint not null,
  device_id  text,
  seq        bigint not null default nextval('public.tallerpro_seq'),
  primary key (user_id, tbl, id)
);

create index if not exists tallerpro_rows_user_seq on public.tallerpro_rows (user_id, seq);

-- Cada alta o cambio recibe un número de secuencia nuevo (para descargar sólo lo nuevo).
create or replace function public.tallerpro_set_seq()
returns trigger
language plpgsql
as $$
begin
  new.seq := nextval('public.tallerpro_seq');
  return new;
end
$$;

drop trigger if exists tallerpro_rows_seq on public.tallerpro_rows;
create trigger tallerpro_rows_seq
  before insert or update on public.tallerpro_rows
  for each row execute function public.tallerpro_set_seq();

-- Seguridad: cada cuenta sólo puede ver y modificar sus propios datos.
alter table public.tallerpro_rows enable row level security;

drop policy if exists "tallerpro_select_own" on public.tallerpro_rows;
drop policy if exists "tallerpro_insert_own" on public.tallerpro_rows;
drop policy if exists "tallerpro_update_own" on public.tallerpro_rows;
drop policy if exists "tallerpro_delete_own" on public.tallerpro_rows;

create policy "tallerpro_select_own" on public.tallerpro_rows
  for select to authenticated using (auth.uid() = user_id);
create policy "tallerpro_insert_own" on public.tallerpro_rows
  for insert to authenticated with check (auth.uid() = user_id);
create policy "tallerpro_update_own" on public.tallerpro_rows
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tallerpro_delete_own" on public.tallerpro_rows
  for delete to authenticated using (auth.uid() = user_id);

revoke all on public.tallerpro_rows from anon;
grant select, insert, update, delete on public.tallerpro_rows to authenticated;
grant usage on sequence public.tallerpro_seq to authenticated;

-- Subida de cambios en lote.
--   rows: [{ "tbl": "clients", "id": "...", "data": {...}, "updated_at": 1731000000000, "device_id": "..." }, ...]
--   · clients / expenses / inventory / settings: gana el cambio más reciente (updated_at).
--   · movements / audit: sólo se agregan (nunca se modifican).
-- Devuelve el número de secuencia más alto de la cuenta.
create or replace function public.tallerpro_push(rows jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  max_seq bigint;
begin
  if auth.uid() is null then
    raise exception 'No has iniciado sesión';
  end if;

  for r in select value from jsonb_array_elements(rows) loop
    if (r ->> 'tbl') in ('movements', 'audit') then
      insert into public.tallerpro_rows (user_id, tbl, id, data, updated_at, device_id)
      values (auth.uid(), r ->> 'tbl', r ->> 'id', r -> 'data', (r ->> 'updated_at')::bigint, r ->> 'device_id')
      on conflict (user_id, tbl, id) do nothing;
    else
      insert into public.tallerpro_rows (user_id, tbl, id, data, updated_at, device_id)
      values (auth.uid(), r ->> 'tbl', r ->> 'id', r -> 'data', (r ->> 'updated_at')::bigint, r ->> 'device_id')
      on conflict (user_id, tbl, id) do update
        set data = excluded.data,
            updated_at = excluded.updated_at,
            device_id = excluded.device_id
        where public.tallerpro_rows.updated_at <= excluded.updated_at;
    end if;
  end loop;

  select coalesce(max(seq), 0) into max_seq from public.tallerpro_rows where user_id = auth.uid();
  return max_seq;
end
$$;

revoke all on function public.tallerpro_push(jsonb) from public, anon;
grant execute on function public.tallerpro_push(jsonb) to authenticated;

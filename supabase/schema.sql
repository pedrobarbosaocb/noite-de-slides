-- Noite de Slides — schema do Supabase
-- Rode este arquivo inteiro no SQL Editor do Supabase (ou via Management API).
-- Depois defina a senha de admin com:
--   insert into private.admin (id, pin_hash) values (1, extensions.crypt('SUA-SENHA', extensions.gen_salt('bf')))
--   on conflict (id) do update set pin_hash = excluded.pin_hash;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------------------------------------------------------------- tabelas
create table if not exists public.presentations (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (char_length(title) between 1 and 120),
  presenter   text not null check (char_length(presenter) between 1 and 80),
  position    int  not null default 0,
  is_open     boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.ratings (
  id              uuid primary key default gen_random_uuid(),
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  voter_id        uuid not null,
  voter_name      text check (char_length(voter_name) <= 60),
  content         smallint not null check (content  between 1 and 5),
  clarity         smallint not null check (clarity  between 1 and 5),
  design          smallint not null check (design   between 1 and 5),
  delivery        smallint not null check (delivery between 1 and 5),
  fun             smallint not null check (fun      between 1 and 5),
  comment         text check (char_length(comment) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (presentation_id, voter_id)
);

create table if not exists private.admin (
  id        int primary key default 1 check (id = 1),
  pin_hash  text not null
);

-- ---------------------------------------------------------------- acesso
alter table public.presentations enable row level security;
alter table public.ratings       enable row level security;

drop policy if exists "leitura publica" on public.presentations;
create policy "leitura publica" on public.presentations for select to anon, authenticated using (true);
drop policy if exists "leitura publica" on public.ratings;
create policy "leitura publica" on public.ratings for select to anon, authenticated using (true);

-- Ninguém escreve direto nas tabelas: toda escrita passa pelas funções abaixo.
revoke all on public.presentations, public.ratings from anon, authenticated;
grant select on public.presentations to anon, authenticated;
-- voter_id funciona como "token" do votante, então não é exposto.
grant select (id, presentation_id, voter_name, content, clarity, design, delivery, fun, comment, created_at)
  on public.ratings to anon, authenticated;

revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- funções
create or replace function private.assert_admin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from private.admin
    where id = 1 and pin_hash = extensions.crypt(coalesce(p_pin, ''), pin_hash)
  ) then
    perform pg_sleep(0.6);
    raise exception 'Senha de admin incorreta';
  end if;
end $$;

-- Votar (ou atualizar o próprio voto)
create or replace function public.submit_rating(
  p_presentation_id uuid, p_voter_id uuid, p_voter_name text,
  p_content int, p_clarity int, p_design int, p_delivery int, p_fun int,
  p_comment text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.presentations where id = p_presentation_id and is_open) then
    raise exception 'A votação desta apresentação está fechada';
  end if;
  insert into public.ratings as r
    (presentation_id, voter_id, voter_name, content, clarity, design, delivery, fun, comment)
  values
    (p_presentation_id, p_voter_id, nullif(left(trim(p_voter_name), 60), ''),
     p_content, p_clarity, p_design, p_delivery, p_fun,
     nullif(left(trim(p_comment), 500), ''))
  on conflict (presentation_id, voter_id) do update set
    voter_name = excluded.voter_name, content = excluded.content, clarity = excluded.clarity,
    design = excluded.design, delivery = excluded.delivery, fun = excluded.fun,
    comment = excluded.comment, updated_at = now();
end $$;

create or replace function public.admin_login(p_pin text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  return true;
end $$;

create or replace function public.admin_create_presentation(p_pin text, p_title text, p_presenter text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.assert_admin(p_pin);
  insert into public.presentations (title, presenter, position)
  values (trim(p_title), trim(p_presenter),
          coalesce((select max(position) + 1 from public.presentations), 0))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_update_presentation(p_pin text, p_id uuid, p_title text, p_presenter text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  update public.presentations set title = trim(p_title), presenter = trim(p_presenter) where id = p_id;
end $$;

-- Abre/fecha uma apresentação. Com p_exclusive = true, fecha todas as outras ao abrir esta.
create or replace function public.admin_set_open(p_pin text, p_id uuid, p_open boolean, p_exclusive boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  if p_open and p_exclusive then
    update public.presentations set is_open = false where id <> p_id and is_open;
  end if;
  update public.presentations set is_open = p_open where id = p_id;
end $$;

create or replace function public.admin_set_all_open(p_pin text, p_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  update public.presentations set is_open = p_open where is_open <> p_open;
end $$;

create or replace function public.admin_move_presentation(p_pin text, p_id uuid, p_dir int)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pos int; v_other uuid;
begin
  perform private.assert_admin(p_pin);
  with o as (
    select id, (row_number() over (order by position, created_at) - 1)::int as rn
    from public.presentations
  )
  update public.presentations p set position = o.rn from o where o.id = p.id;

  select position into v_pos from public.presentations where id = p_id;
  select id into v_other from public.presentations where position = v_pos + sign(p_dir)::int;
  if v_other is null then return; end if;
  update public.presentations set position = v_pos where id = v_other;
  update public.presentations set position = v_pos + sign(p_dir)::int where id = p_id;
end $$;

create or replace function public.admin_delete_presentation(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  delete from public.presentations where id = p_id;
end $$;

create or replace function public.admin_clear_ratings(p_pin text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  delete from public.ratings where presentation_id = p_id;
end $$;

create or replace function public.admin_change_pin(p_pin text, p_new_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_admin(p_pin);
  if char_length(coalesce(p_new_pin, '')) < 6 then
    raise exception 'A nova senha precisa ter pelo menos 6 caracteres';
  end if;
  update private.admin set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf')) where id = 1;
end $$;

revoke all on function private.assert_admin(text) from public, anon, authenticated;
grant execute on function
  public.submit_rating(uuid, uuid, text, int, int, int, int, int, text),
  public.admin_login(text),
  public.admin_create_presentation(text, text, text),
  public.admin_update_presentation(text, uuid, text, text),
  public.admin_set_open(text, uuid, boolean, boolean),
  public.admin_set_all_open(text, boolean),
  public.admin_move_presentation(text, uuid, int),
  public.admin_delete_presentation(text, uuid),
  public.admin_clear_ratings(text, uuid),
  public.admin_change_pin(text, text)
to anon, authenticated;

notify pgrst, 'reload schema';

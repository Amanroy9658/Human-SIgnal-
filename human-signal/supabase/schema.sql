-- HUMAN SIGNAL: run this entire file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.rooms (
  code text primary key check (code ~ '^[A-Z0-9]{6}$'),
  status text not null default 'lobby' check (status in ('lobby','playing','finished')),
  host_id uuid not null,
  current_round int not null default 0,
  total_rounds int not null default 5 check (total_rounds between 3 and 8),
  question_id text,
  round_ends_at timestamptz,
  mode text not null default 'MIXED',
  used_question_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  nickname text not null check (char_length(nickname) between 2 and 16),
  score int not null default 0,
  is_host boolean not null default false,
  ready boolean not null default false,
  joined_at timestamptz not null default now(),
  unique(room_code, nickname)
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  question_id text not null,
  answer_index int not null,
  correct boolean not null,
  points int not null default 0,
  submitted_at timestamptz not null default now(),
  unique(room_code, player_id, question_id)
);

create index if not exists players_room_idx on public.players(room_code);
create index if not exists answers_room_question_idx on public.answers(room_code, question_id);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;

-- Public read access is needed for no-login room play. Writes are RPC-only.
drop policy if exists "rooms are readable" on public.rooms;
create policy "rooms are readable" on public.rooms for select using (true);
drop policy if exists "players are readable" on public.players;
create policy "players are readable" on public.players for select using (true);
drop policy if exists "answers are readable" on public.answers;
create policy "answers are readable" on public.answers for select using (true);

revoke insert, update, delete on public.rooms from anon, authenticated;
revoke insert, update, delete on public.players from anon, authenticated;
revoke insert, update, delete on public.answers from anon, authenticated;

create or replace function public.create_room(p_nickname text,p_total_rounds int default 5,p_mode text default 'MIXED')
returns table(room_code text,player_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_code text; v_player uuid;
begin
  if char_length(trim(p_nickname)) not between 2 and 16 then raise exception 'Nickname must be 2–16 characters'; end if;
  if p_total_rounds not between 3 and 8 then raise exception 'Rounds must be between 3 and 8'; end if;
  loop
    v_code := upper(substr(encode(gen_random_bytes(5),'hex'),1,6));
    exit when not exists(select 1 from rooms where code=v_code);
  end loop;
  insert into rooms(code,host_id,total_rounds,mode) values(v_code,gen_random_uuid(),p_total_rounds,p_mode);
  insert into players(room_code,nickname,is_host,ready) values(v_code,trim(p_nickname),true,true) returning id into v_player;
  update rooms set host_id=v_player where code=v_code;
  return query select v_code,v_player;
end $$;

create or replace function public.join_room(p_room_code text,p_nickname text)
returns table(player_id uuid)
language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_count int;
begin
  if char_length(trim(p_nickname)) not between 2 and 16 then raise exception 'Nickname must be 2–16 characters'; end if;
  perform 1 from rooms where code=upper(trim(p_room_code)) and status='lobby' for update;
  if not found then raise exception 'Room not found or game already started'; end if;
  select count(*) into v_count from players where room_code=upper(trim(p_room_code));
  if v_count>=8 then raise exception 'Room is full (8 players maximum)'; end if;
  insert into players(room_code,nickname) values(upper(trim(p_room_code)),trim(p_nickname)) returning id into v_id;
  return query select v_id;
end $$;

create or replace function public.toggle_ready(p_player_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update players set ready=not ready where id=p_player_id and is_host=false
    and exists(select 1 from rooms r where r.code=players.room_code and r.status='lobby');
  if not found then raise exception 'Could not update ready status'; end if;
  return true;
end $$;

create or replace function public.start_game(p_room_code text,p_host_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_room rooms%rowtype; v_q text;
begin
  select * into v_room from rooms where code=upper(p_room_code) for update;
  if not found or v_room.host_id<>p_host_id then raise exception 'Only the host can start this game'; end if;
  if v_room.status<>'lobby' then raise exception 'Game already started'; end if;
  if (select count(*) from players where room_code=v_room.code)<2 then raise exception 'At least 2 players are required'; end if;
  v_q := case when v_room.mode='MIXED' then 'q1' else
    (select id from (values ('q1','PROMPT MASTER'),('q2','HALLUCINATION HUNTER'),('q3','AI JUDGE'),('q4','BIAS BUSTER'),('q5','HUMAN VS AI'),('q6','PROMPT MASTER'),('q7','HALLUCINATION HUNTER'),('q8','AI JUDGE'),('q9','BIAS BUSTER'),('q10','HUMAN VS AI')) as q(id,mode) where mode=v_room.mode order by random() limit 1) end;
  update rooms set status='playing',current_round=1,question_id=v_q,round_ends_at=now()+interval '25 seconds',used_question_ids=array[v_q],updated_at=now() where code=v_room.code;
  return true;
end $$;

create or replace function public.submit_answer(p_room_code text,p_player_id uuid,p_question_id text,p_answer_index int)
returns table(correct boolean,points int)
language plpgsql security definer set search_path=public as $$
declare v_room rooms%rowtype; v_correct int; v_points int; v_answered int;
begin
  select * into v_room from rooms where code=upper(p_room_code) for update;
  if not found or v_room.status<>'playing' or v_room.question_id<>p_question_id then raise exception 'This round is no longer active'; end if;
  if now()>v_room.round_ends_at then raise exception 'Time is up'; end if;
  if not exists(select 1 from players where id=p_player_id and room_code=v_room.code) then raise exception 'Player is not in this room'; end if;
  if exists(select 1 from answers where room_code=v_room.code and player_id=p_player_id and question_id=p_question_id) then raise exception 'Answer already submitted'; end if;
  v_correct := case p_question_id when 'q1' then 1 when 'q2' then 1 when 'q3' then 1 when 'q4' then 1 when 'q5' then 1 when 'q6' then 2 when 'q7' then 0 when 'q8' then 1 when 'q9' then 1 when 'q10' then 1 else -1 end;
  if p_answer_index not between 0 and 3 then raise exception 'Invalid answer'; end if;
  v_points := case when p_answer_index=v_correct then 100 + greatest(0,least(50, floor(extract(epoch from (v_room.round_ends_at-now()))*2)::int)) else 0 end;
  insert into answers(room_code,player_id,question_id,answer_index,correct,points) values(v_room.code,p_player_id,p_question_id,p_answer_index,p_answer_index=v_correct,v_points);
  update players set score=score+v_points where id=p_player_id;
  return query select p_answer_index=v_correct,v_points;
end $$;

create or replace function public.advance_round(p_room_code text,p_host_id uuid)
returns boolean language plpgsql security definer set search_path=public as $$
declare v_room rooms%rowtype; v_q text;
begin
  select * into v_room from rooms where code=upper(p_room_code) for update;
  if not found or v_room.host_id<>p_host_id then raise exception 'Only the host can advance the round'; end if;
  if v_room.status<>'playing' then raise exception 'Game is not active'; end if;
  if v_room.current_round>=v_room.total_rounds then
    update rooms set status='finished',updated_at=now() where code=v_room.code;
  else
    select id into v_q from (values ('q1','PROMPT MASTER'),('q2','HALLUCINATION HUNTER'),('q3','AI JUDGE'),('q4','BIAS BUSTER'),('q5','HUMAN VS AI'),('q6','PROMPT MASTER'),('q7','HALLUCINATION HUNTER'),('q8','AI JUDGE'),('q9','BIAS BUSTER'),('q10','HUMAN VS AI')) as q(id,mode)
    where (v_room.mode='MIXED' or q.mode=v_room.mode) and not(q.id=any(v_room.used_question_ids))
    order by random() limit 1;
    if v_q is null then v_q := 'q1'; end if;
    update rooms set current_round=current_round+1,question_id=v_q,round_ends_at=now()+interval '25 seconds',used_question_ids=array_append(used_question_ids,v_q),updated_at=now() where code=v_room.code;
  end if;
  return true;
end $$;

grant execute on function public.create_room(text,int,text) to anon, authenticated;
grant execute on function public.join_room(text,text) to anon, authenticated;
grant execute on function public.toggle_ready(uuid) to anon, authenticated;
grant execute on function public.start_game(text,uuid) to anon, authenticated;
grant execute on function public.submit_answer(text,uuid,text,int) to anon, authenticated;
grant execute on function public.advance_round(text,uuid) to anon, authenticated;

-- Enable realtime replication for room and player updates.
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
when others then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.players;
exception when duplicate_object then null;
when others then null;
end $$;

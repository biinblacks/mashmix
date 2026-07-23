-- MashMix database schema
-- Run this in Supabase SQL Editor after creating the project

-- Profiles table: extends auth.users with subscription info
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text not null,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text default 'free' check (subscription_status in ('free', 'active', 'canceled', 'past_due')),
  usage_count_this_month int default 0,
  usage_reset_at timestamptz default (date_trunc('month', now()) + interval '1 month'),
  created_at timestamptz default now()
);

-- Tracks table: uploaded songs + their analyzed audio features
create table if not exists public.tracks (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  file_name text not null,
  storage_path text not null,
  duration_seconds numeric,
  bpm numeric,
  musical_key text,       -- e.g. "8A" (Camelot notation)
  key_confidence numeric,
  energy numeric,          -- 0-1 rough energy/loudness score
  analysis_status text default 'pending' check (analysis_status in ('pending', 'processing', 'done', 'failed')),
  created_at timestamptz default now()
);

-- Match suggestions: precomputed pairs of tracks that are good mashup candidates
create table if not exists public.match_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  track_a_id uuid references public.tracks(id) on delete cascade not null,
  track_b_id uuid references public.tracks(id) on delete cascade not null,
  compatibility_score numeric not null, -- 0-100
  bpm_diff numeric,
  key_relation text, -- 'same', 'adjacent', 'energy_boost', 'energy_drop', 'relative_minor_major'
  created_at timestamptz default now()
);

-- Mashups: actual generated mashup jobs via LALAL.ai
create table if not exists public.mashups (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  track_a_id uuid references public.tracks(id) on delete cascade not null,
  track_b_id uuid references public.tracks(id) on delete cascade not null,
  lalal_task_id text,
  status text default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  result_storage_path text,
  created_at timestamptz default now()
);

-- Row Level Security
alter table public.profiles enable row level security;
alter table public.tracks enable row level security;
alter table public.match_suggestions enable row level security;
alter table public.mashups enable row level security;

create policy "Users can view own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "Users can view own tracks" on public.tracks
  for select using (auth.uid() = user_id);
create policy "Users can insert own tracks" on public.tracks
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own tracks" on public.tracks
  for delete using (auth.uid() = user_id);

create policy "Users can view own match suggestions" on public.match_suggestions
  for select using (auth.uid() = user_id);
create policy "Users can insert own match suggestions" on public.match_suggestions
  for insert with check (auth.uid() = user_id);

create policy "Users can view own mashups" on public.mashups
  for select using (auth.uid() = user_id);
create policy "Users can insert own mashups" on public.mashups
  for insert with check (auth.uid() = user_id);

-- Auto-create profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Storage bucket for uploaded tracks (run once)
insert into storage.buckets (id, name, public)
values ('tracks', 'tracks', false)
on conflict (id) do nothing;

create policy "Users can upload own tracks to storage"
  on storage.objects for insert
  with check (bucket_id = 'tracks' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "Users can read own tracks from storage"
  on storage.objects for select
  using (bucket_id = 'tracks' and auth.uid()::text = (storage.foldername(name))[1]);

-- TULONG PH production schema
create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  city text,
  avatar_url text,
  role text not null default 'user' check (role in ('user','admin','reviewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  slug text unique,
  category text not null check (category in ('Medical','Disability','Family','Bereavement','Pets','Education','Emergency','Livelihood')),
  beneficiary_name text not null,
  city text not null,
  story text not null,
  goal_amount numeric(12,2) not null check (goal_amount > 0),
  raised_amount numeric(12,2) not null default 0 check (raised_amount >= 0),
  donor_count integer not null default 0 check (donor_count >= 0),
  cover_image_url text,
  status text not null default 'pending_review' check (status in ('draft','pending_review','verified','active','paused','completed','rejected','closed')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','pending','verified','rejected')),
  submitted_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_updates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.verification_documents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  uploaded_by uuid not null references public.profiles(id) on delete cascade,
  document_type text not null,
  storage_path text not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  reviewer_id uuid references public.profiles(id),
  reviewer_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.donations (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  donor_id uuid references public.profiles(id) on delete set null,
  donor_name text,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'PHP',
  payment_provider text,
  payment_reference text,
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded','cancelled')),
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_reports (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  reporter_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  reviewer_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.sponsored_content (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  sponsor_name text not null,
  media_url text,
  destination_url text,
  placement text not null default 'discover' check (placement in ('hero','discover','campaign','footer')),
  status text not null default 'draft' check (status in ('draft','pending_review','active','paused','expired')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists campaigns_status_idx on public.campaigns(status);
create index if not exists campaigns_category_idx on public.campaigns(category);
create index if not exists campaigns_owner_idx on public.campaigns(owner_id);
create index if not exists donations_campaign_idx on public.donations(campaign_id);
create index if not exists reports_status_idx on public.campaign_reports(status);

alter table public.profiles enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_updates enable row level security;
alter table public.verification_documents enable row level security;
alter table public.donations enable row level security;
alter table public.campaign_reports enable row level security;
alter table public.sponsored_content enable row level security;

-- Public discovery only exposes campaigns explicitly active/verified.
create policy "public can discover verified campaigns" on public.campaigns
for select to anon, authenticated
using (status in ('verified','active'));

create policy "owners can view own campaigns" on public.campaigns
for select to authenticated
using ((select auth.uid()) = owner_id);

create policy "owners can create campaigns" on public.campaigns
for insert to authenticated
with check ((select auth.uid()) = owner_id);

create policy "owners can update their draft/pending campaigns" on public.campaigns
for update to authenticated
using ((select auth.uid()) = owner_id and status in ('draft','pending_review'))
with check ((select auth.uid()) = owner_id and status in ('draft','pending_review'));

create policy "users can manage own profile" on public.profiles
for all to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "public can read updates for public campaigns" on public.campaign_updates
for select to anon, authenticated
using (exists (select 1 from public.campaigns c where c.id=campaign_id and c.status in ('verified','active')));

create policy "owners can create updates" on public.campaign_updates
for insert to authenticated
with check ((select auth.uid()) = author_id and exists (select 1 from public.campaigns c where c.id=campaign_id and c.owner_id=(select auth.uid())));

create policy "donors can read their own donations" on public.donations
for select to authenticated
using ((select auth.uid()) = donor_id);

create policy "admins can manage all application data"
on public.campaigns for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'))
with check ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'));

create policy "admins can manage verification documents"
on public.verification_documents for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'))
with check ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'));

create policy "admins can manage reports"
on public.campaign_reports for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'))
with check ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'));

create policy "admins can manage sponsored content"
on public.sponsored_content for all to authenticated
using ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'))
with check ((select auth.jwt()->'app_metadata'->>'role') in ('admin','reviewer'));

create policy "public can view active sponsored content"
on public.sponsored_content for select to anon, authenticated
using (status='active' and (starts_at is null or starts_at<=now()) and (ends_at is null or ends_at>=now()));

-- Owner-only document visibility; public never gets raw verification files.
create policy "owners can view own verification docs"
on public.verification_documents for select to authenticated
using (uploaded_by=(select auth.uid()));

create policy "owners can upload verification docs"
on public.verification_documents for insert to authenticated
with check (uploaded_by=(select auth.uid()) and exists (
  select 1 from public.campaigns c where c.id=campaign_id and c.owner_id=(select auth.uid())
));

-- Seed-friendly update trigger.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end; $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists campaigns_updated_at on public.campaigns;
create trigger campaigns_updated_at before update on public.campaigns for each row execute function public.set_updated_at();

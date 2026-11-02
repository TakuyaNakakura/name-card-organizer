create schema if not exists name_card_auth;
create schema if not exists name_card;

create table if not exists name_card_auth."user" (
  id text primary key, name text not null, email text not null unique,
  "emailVerified" boolean not null default false, image text,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create table if not exists name_card_auth.session (
  id text primary key, "expiresAt" timestamptz not null, token text not null unique,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
  "ipAddress" text, "userAgent" text, "userId" text not null references name_card_auth."user"(id) on delete cascade
);
create table if not exists name_card_auth.account (
  id text primary key, "accountId" text not null, "providerId" text not null,
  "userId" text not null references name_card_auth."user"(id) on delete cascade,
  "accessToken" text, "refreshToken" text, "idToken" text,
  "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, scope text, password text,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(),
  unique("providerId", "accountId")
);
create table if not exists name_card_auth.verification (
  id text primary key, identifier text not null, value text not null, "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now()
);
create index if not exists idx_session_user on name_card_auth.session("userId");
create index if not exists idx_verification_identifier on name_card_auth.verification(identifier);
create table if not exists name_card_auth."rateLimit" (
  id text primary key, key text not null unique, count integer not null, "lastRequest" bigint not null
);

create table if not exists name_card.teams (
  id uuid primary key, name text not null, created_at timestamptz not null default now()
);
create table if not exists name_card.memberships (
  team_id uuid not null references name_card.teams, user_id text not null references name_card_auth."user",
  role text not null check(role in ('admin','member')), status text not null default 'active' check(status in ('active','suspended')),
  created_at timestamptz not null default now(), primary key(team_id, user_id), unique(user_id)
);
create table if not exists name_card.invitations (
  id uuid primary key, team_id uuid not null references name_card.teams, email text not null,
  role text not null check(role in ('admin','member')), expires_at timestamptz not null,
  accepted_at timestamptz, revoked_at timestamptz, created_by text references name_card_auth."user",
  created_at timestamptz not null default now(), unique(team_id,email)
);
create table if not exists name_card.drafts (
  id uuid primary key, team_id uuid not null references name_card.teams, owner_id text not null references name_card_auth."user",
  client_scan_id uuid not null, status text not null default 'processing' check(status in ('processing','ready','failed','confirmed','discarded')),
  full_name text, organization text, job_title text, email text,
  raw_ocr_text text not null default '', confidence real not null default 0, warnings jsonb not null default '[]',
  error_code text, error_message text, version integer not null default 1,
  lease_until timestamptz, expires_at timestamptz not null default now()+interval '7 days',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(team_id,owner_id,client_scan_id)
);
create table if not exists name_card.cards (
  id uuid primary key, team_id uuid not null references name_card.teams,
  created_by text references name_card_auth."user", updated_by text references name_card_auth."user",
  source_draft_id uuid unique references name_card.drafts, full_name text, organization text, job_title text, email text,
  raw_ocr_text text not null default '', extraction_confidence real not null default 0,
  version integer not null default 1, deleted_at timestamptz, deleted_by text references name_card_auth."user",
  imported boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists name_card.assets (
  id uuid primary key, team_id uuid not null references name_card.teams, draft_id uuid references name_card.drafts,
  card_id uuid references name_card.cards, kind text not null check(kind in ('original','corrected')),
  storage_key text not null unique, content_type text not null, byte_size integer not null,
  created_at timestamptz not null default now(), unique(draft_id,kind)
);
create table if not exists name_card.audit_events (
  id bigint generated always as identity primary key, team_id uuid not null references name_card.teams,
  actor_id text references name_card_auth."user", action text not null, target_id text,
  created_at timestamptz not null default now()
);
create table if not exists name_card.usage_counters (
  scope text not null, window_start timestamptz not null, count integer not null,
  primary key(scope,window_start)
);
create table if not exists name_card.maintenance_runs (
  id bigint generated always as identity primary key, completed_at timestamptz not null default now(),
  deleted_assets integer not null, failed_assets integer not null
);
create index if not exists idx_team_cards on name_card.cards(team_id,created_at desc,id desc) where deleted_at is null;
create index if not exists idx_owner_drafts on name_card.drafts(team_id,owner_id,created_at desc);
create index if not exists idx_assets_card on name_card.assets(card_id);
create index if not exists idx_assets_draft on name_card.assets(draft_id);
create index if not exists idx_cards_email on name_card.cards(team_id,lower(email)) where deleted_at is null;

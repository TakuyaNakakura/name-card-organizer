create table if not exists cards (
  id uuid primary key,
  full_name text,
  email text not null,
  original_image_url text not null,
  corrected_image_url text not null,
  raw_ocr_text text not null,
  extraction_confidence real not null,
  status text not null check (status in ('confirmed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cards_created_at on cards (created_at desc);
create index if not exists idx_cards_search on cards (lower(coalesce(full_name, '')), lower(email));

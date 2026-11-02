alter table name_card_auth."user" add column if not exists username text;
create unique index if not exists idx_user_username on name_card_auth."user"(username) where username is not null;
alter table name_card.memberships add column if not exists password_change_required boolean not null default false;

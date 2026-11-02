-- Run with the migration owner AFTER creating a separate LOGIN role named name_card_app.
-- Set its password in the provider UI/secret manager, never in a committed SQL file.
grant usage on schema name_card, name_card_auth to name_card_app;
grant select, insert, update, delete on all tables in schema name_card, name_card_auth to name_card_app;
grant usage, select on all sequences in schema name_card to name_card_app;
revoke all on name_card.migrations from name_card_app;
revoke create on schema name_card, name_card_auth from name_card_app;
-- Do not grant this role privileges on public.cards or other services' schemas.

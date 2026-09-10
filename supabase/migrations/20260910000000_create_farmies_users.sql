create schema farmies;

create table farmies.users (
  id bigint generated always as identity
    constraint users_pkey primary key,
  auth_user_id uuid
    constraint users_auth_user_id_key unique
    constraint users_auth_user_id_fkey
      references auth.users (id) on delete set null,
  preferred_locale varchar(2) not null default 'en'
    constraint users_preferred_locale_check
      check (preferred_locale in ('en', 'es')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint users_deleted_at_check
    check (deleted_at is null or deleted_at >= created_at),
  constraint users_active_auth_user_check
    check (deleted_at is not null or auth_user_id is not null)
);

revoke all on schema farmies from public;
revoke all on farmies.users from public;
revoke all on sequence farmies.users_id_seq from public;

grant usage on schema farmies to farmies_api;
grant select on farmies.users to farmies_api;
grant insert (auth_user_id, preferred_locale)
  on farmies.users to farmies_api;
grant update (preferred_locale, updated_at, deleted_at)
  on farmies.users to farmies_api;
grant usage on sequence farmies.users_id_seq to farmies_api;

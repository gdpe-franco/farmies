create table farmies.species (
  id bigint generated always as identity primary key,
  code varchar(32) not null unique
    constraint species_code_check check (code ~ '^[A-Z][A-Z0-9_]*$'),
  created_at timestamptz not null default now()
);

create table farmies.environments (
  id bigint generated always as identity primary key,
  code varchar(32) not null unique
    constraint environments_code_check check (code ~ '^[A-Z][A-Z0-9_]*$'),
  definition jsonb not null
    constraint environments_definition_check check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table farmies.species_environments (
  species_id bigint not null references farmies.species (id) on delete restrict,
  environment_id bigint not null references farmies.environments (id) on delete restrict,
  primary key (species_id, environment_id)
);

create table farmies.parties (
  id bigint generated always as identity primary key,
  owner_user_id bigint not null references farmies.users (id) on delete restrict,
  display_name varchar(60) not null
    constraint parties_display_name_check check (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 60
    ),
  species_id bigint not null,
  environment_id bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint parties_species_id_environment_id_fkey
    foreign key (species_id, environment_id)
    references farmies.species_environments (species_id, environment_id)
    on delete restrict,
  constraint parties_deleted_at_check check (deleted_at is null or deleted_at >= created_at)
);

create unique index parties_active_owner_uidx
  on farmies.parties (owner_user_id)
  where deleted_at is null;

create table farmies.memberships (
  id bigint generated always as identity primary key,
  party_id bigint not null references farmies.parties (id) on delete restrict,
  user_id bigint not null references farmies.users (id) on delete restrict,
  nickname varchar(40) not null
    constraint memberships_nickname_check check (
      nickname = btrim(nickname)
      and char_length(nickname) between 1 and 40
    ),
  joined_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint memberships_deleted_at_check check (deleted_at is null or deleted_at >= joined_at)
);

create unique index memberships_active_user_uidx
  on farmies.memberships (user_id)
  where deleted_at is null;

create index memberships_active_party_joined_idx
  on farmies.memberships (party_id, joined_at, id)
  where deleted_at is null;

create table farmies.invites (
  party_id bigint primary key references farmies.parties (id) on delete restrict,
  token_hash varchar(64) not null unique
    constraint invites_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint invites_expires_at_check check (expires_at > created_at),
  constraint invites_revoked_at_check check (revoked_at is null or revoked_at >= created_at),
  constraint invites_deleted_at_check check (deleted_at is null or deleted_at >= created_at)
);

create table farmies.member_avatars (
  membership_id bigint primary key references farmies.memberships (id) on delete restrict,
  object_key text not null unique,
  media_type varchar(32) not null
    constraint member_avatars_media_type_check check (media_type = 'image/webp'),
  byte_size integer not null
    constraint member_avatars_byte_size_check check (byte_size between 1 and 524288),
  width smallint not null
    constraint member_avatars_width_check check (width = 512),
  height smallint not null
    constraint member_avatars_height_check check (height = 512),
  version integer not null default 1
    constraint member_avatars_version_check check (version > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint member_avatars_deleted_at_check check (deleted_at is null or deleted_at >= updated_at)
);

insert into farmies.species (code) values ('COW');

insert into farmies.environments (code, definition)
values ('PASTURE', '{"version": 1, "scene": "PASTURE", "zones": [], "props": [], "capabilities": []}');

insert into farmies.species_environments (species_id, environment_id)
select species.id, environments.id
from farmies.species
cross join farmies.environments
where species.code = 'COW' and environments.code = 'PASTURE';

revoke all on farmies.species, farmies.environments, farmies.species_environments,
  farmies.parties, farmies.memberships, farmies.invites, farmies.member_avatars from public;
revoke all on sequence farmies.species_id_seq, farmies.environments_id_seq,
  farmies.parties_id_seq, farmies.memberships_id_seq from public;

grant select on farmies.species, farmies.environments, farmies.species_environments,
  farmies.parties, farmies.memberships, farmies.invites, farmies.member_avatars to farmies_api;
grant insert (owner_user_id, display_name, species_id, environment_id)
  on farmies.parties to farmies_api;
grant update (owner_user_id, display_name, updated_at, deleted_at)
  on farmies.parties to farmies_api;
grant insert (party_id, user_id, nickname)
  on farmies.memberships to farmies_api;
grant update (nickname, deleted_at)
  on farmies.memberships to farmies_api;
grant insert (party_id, token_hash, expires_at)
  on farmies.invites to farmies_api;
grant update (token_hash, expires_at, revoked_at, created_at, deleted_at)
  on farmies.invites to farmies_api;
grant insert (membership_id, object_key, media_type, byte_size, width, height)
  on farmies.member_avatars to farmies_api;
grant update (object_key, media_type, byte_size, width, height, version, updated_at, deleted_at)
  on farmies.member_avatars to farmies_api;
grant usage on sequence farmies.parties_id_seq, farmies.memberships_id_seq to farmies_api;

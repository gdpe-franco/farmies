begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- Happy path: the approved model, seed data, and runtime access are present.
select has_table('farmies', table_name, format('farmies.%s exists', table_name))
from unnest(array[
  'species',
  'environments',
  'species_environments',
  'parties',
  'memberships',
  'invites',
  'member_avatars'
]) as table_name;

select columns_are('farmies', table_name, expected_columns)
from (
  values
    ('species', array['id', 'code', 'created_at']),
    ('environments', array['id', 'code', 'definition', 'created_at', 'updated_at']),
    ('species_environments', array['species_id', 'environment_id']),
    ('parties', array['id', 'owner_user_id', 'display_name', 'species_id', 'environment_id', 'created_at', 'updated_at', 'deleted_at']),
    ('memberships', array['id', 'party_id', 'user_id', 'nickname', 'joined_at', 'deleted_at']),
    ('invites', array['party_id', 'token_hash', 'expires_at', 'revoked_at', 'created_at', 'deleted_at']),
    ('member_avatars', array['membership_id', 'object_key', 'media_type', 'byte_size', 'width', 'height', 'version', 'updated_at', 'deleted_at'])
) as expected(table_name, expected_columns);

select results_eq(
  $$select code from farmies.species order by code$$,
  $$values ('COW'::varchar)$$,
  'only COW is seeded'
);

select results_eq(
  $$select code from farmies.environments order by code$$,
  $$values ('PASTURE'::varchar)$$,
  'only PASTURE is seeded'
);

select results_eq(
  $$
    select species.code, environments.code
    from farmies.species_environments
    join farmies.species on species.id = species_environments.species_id
    join farmies.environments on environments.id = species_environments.environment_id
  $$,
  $$values ('COW'::varchar, 'PASTURE'::varchar)$$,
  'only the COW and PASTURE combination is supported'
);

select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'farmies'
      and table_name in ('species', 'environments', 'parties', 'memberships', 'invites', 'member_avatars')
      and column_name in ('created_at', 'updated_at', 'joined_at', 'expires_at', 'revoked_at', 'deleted_at')
      and data_type = 'timestamp with time zone'
  ),
  14,
  'all Party-model moments are timezone-aware UTC instants'
);

select is(
  (
    select array_agg(indexname order by indexname)
    from pg_indexes
    where schemaname = 'farmies'
      and indexname in (
        'parties_active_owner_idx',
        'memberships_active_user_idx',
        'memberships_active_party_user_uidx',
        'memberships_active_party_joined_idx'
      )
  ),
  array[
    'memberships_active_party_joined_idx',
    'memberships_active_party_user_uidx',
    'memberships_active_user_idx',
    'parties_active_owner_idx'
  ]::name[],
  'the four approved active-row indexes exist'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'farmies'
      and indexname = 'memberships_active_party_user_uidx'
      and indexdef like '%UNIQUE%WHERE (deleted_at IS NULL)%'
  ),
  1,
  'one active membership per user and Party is uniquely enforced'
);

select is(
  (
    select count(*)::integer
    from pg_constraint constraint_definition
    join pg_class table_definition on table_definition.oid = constraint_definition.conrelid
    join pg_namespace schema_definition on schema_definition.oid = table_definition.relnamespace
    where schema_definition.nspname = 'farmies'
      and table_definition.relname <> 'users'
      and constraint_definition.contype = 'f'
  ),
  8,
  'all approved Party-model foreign keys exist'
);

select ok(
  (
    select definition ?& array['version', 'scene', 'zones', 'props', 'capabilities']
      and jsonb_typeof(definition) = 'object'
    from farmies.environments
    where code = 'PASTURE'
  ),
  'PASTURE has the minimal versioned scene contract'
);

select ok(
  (
    select bool_and(has_table_privilege('farmies_api', format('farmies.%I', table_name), 'select'))
    from unnest(array[
      'species', 'environments', 'species_environments', 'parties',
      'memberships', 'invites', 'member_avatars'
    ]) as table_name
  ),
  'farmies_api can read every Party-model table'
);

select ok(
  (
    select bool_and(not has_table_privilege('farmies_api', format('farmies.%I', table_name), 'delete'))
    from unnest(array[
      'species', 'environments', 'species_environments', 'parties',
      'memberships', 'invites', 'member_avatars'
    ]) as table_name
  ),
  'farmies_api cannot delete Party-model rows'
);

-- Failure path: broad writes, catalog mutation, and sequence inspection stay unavailable.
select ok(
  not has_table_privilege('farmies_api', 'farmies.parties', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.parties', 'update')
    and not has_table_privilege('farmies_api', 'farmies.memberships', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.memberships', 'update')
    and not has_table_privilege('farmies_api', 'farmies.invites', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.invites', 'update')
    and not has_table_privilege('farmies_api', 'farmies.member_avatars', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.member_avatars', 'update'),
  'farmies_api has no table-wide write privileges'
);

select ok(
  not has_table_privilege('farmies_api', 'farmies.species', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.environments', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.species_environments', 'insert'),
  'farmies_api cannot mutate migration-managed catalogs'
);

select ok(
  has_sequence_privilege('farmies_api', 'farmies.parties_id_seq', 'usage')
    and has_sequence_privilege('farmies_api', 'farmies.memberships_id_seq', 'usage')
    and not has_sequence_privilege('farmies_api', 'farmies.parties_id_seq', 'select')
    and not has_sequence_privilege('farmies_api', 'farmies.memberships_id_seq', 'select')
    and not has_sequence_privilege('farmies_api', 'farmies.species_id_seq', 'usage')
    and not has_sequence_privilege('farmies_api', 'farmies.environments_id_seq', 'usage'),
  'farmies_api can generate runtime IDs without reading sequences or generating catalog IDs'
);

select * from finish();

rollback;

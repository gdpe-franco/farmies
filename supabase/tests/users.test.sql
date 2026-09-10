begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_schema('farmies');
select has_table('farmies', 'users', 'farmies.users exists');
select columns_are(
  'farmies',
  'users',
  array['id', 'auth_user_id', 'preferred_locale', 'created_at', 'updated_at', 'deleted_at']
);
select col_is_pk('farmies', 'users', 'id', 'id is the primary key');
select col_is_unique('farmies', 'users', 'auth_user_id', 'Auth identities are unique');
select col_is_fk('farmies', 'users', 'auth_user_id', 'Auth identity references auth.users');
select is(
  (
    select count(*)::integer
    from pg_constraint constraint_definition
    join pg_class table_definition on table_definition.oid = constraint_definition.conrelid
    join pg_namespace schema_definition on schema_definition.oid = table_definition.relnamespace
    where schema_definition.nspname = 'farmies'
      and table_definition.relname = 'users'
      and constraint_definition.contype = 'c'
  ),
  3,
  'users has its three approved check constraints'
);
select is(
  (
    select array_agg(constraint_definition.conname order by constraint_definition.conname)
    from pg_constraint constraint_definition
    join pg_class table_definition on table_definition.oid = constraint_definition.conrelid
    join pg_namespace schema_definition on schema_definition.oid = table_definition.relnamespace
    where schema_definition.nspname = 'farmies'
      and table_definition.relname = 'users'
  ),
  array[
    'users_active_auth_user_check',
    'users_auth_user_id_fkey',
    'users_auth_user_id_key',
    'users_deleted_at_check',
    'users_pkey',
    'users_preferred_locale_check'
  ]::name[],
  'constraints use conventional PostgreSQL names'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'farmies'
      and table_name = 'users'
      and column_name in ('created_at', 'updated_at', 'deleted_at')
      and data_type = 'timestamp with time zone'
  ),
  3,
  'all user moments are timezone-aware UTC instants'
);
select ok(
  has_schema_privilege('farmies_api', 'farmies', 'usage')
    and not has_schema_privilege('farmies_api', 'farmies', 'create'),
  'farmies_api can use but cannot create in the schema'
);
select ok(
  has_table_privilege('farmies_api', 'farmies.users', 'select')
    and not has_table_privilege('farmies_api', 'farmies.users', 'insert')
    and not has_table_privilege('farmies_api', 'farmies.users', 'update')
    and not has_table_privilege('farmies_api', 'farmies.users', 'delete'),
  'farmies_api can read the table but has no table-wide write privileges'
);
select ok(
  has_column_privilege('farmies_api', 'farmies.users', 'auth_user_id', 'insert')
    and has_column_privilege('farmies_api', 'farmies.users', 'preferred_locale', 'insert')
    and has_column_privilege('farmies_api', 'farmies.users', 'preferred_locale', 'update')
    and has_column_privilege('farmies_api', 'farmies.users', 'updated_at', 'update')
    and has_column_privilege('farmies_api', 'farmies.users', 'deleted_at', 'update')
    and not has_column_privilege('farmies_api', 'farmies.users', 'id', 'insert')
    and not has_column_privilege('farmies_api', 'farmies.users', 'auth_user_id', 'update')
    and not has_column_privilege('farmies_api', 'farmies.users', 'created_at', 'update'),
  'farmies_api can write only application-managed columns'
);
select ok(
  not rolcanlogin
    and not rolsuper
    and not rolcreatedb
    and not rolcreaterole
    and not rolreplication
    and not rolbypassrls,
  'farmies_api is an unprivileged non-login access role'
)
from pg_roles
where rolname = 'farmies_api';

select ok(
  has_sequence_privilege('farmies_api', 'farmies.users_id_seq', 'usage')
    and not has_sequence_privilege('farmies_api', 'farmies.users_id_seq', 'select')
    and not has_sequence_privilege('farmies_api', 'farmies.users_id_seq', 'update'),
  'farmies_api can generate identifiers without inspecting or changing the sequence'
);

select * from finish();

rollback;

drop index farmies.parties_active_owner_uidx;
drop index farmies.memberships_active_user_uidx;

create index parties_active_owner_idx
  on farmies.parties (owner_user_id)
  where deleted_at is null;

create index memberships_active_user_idx
  on farmies.memberships (user_id)
  where deleted_at is null;

create unique index memberships_active_party_user_uidx
  on farmies.memberships (party_id, user_id)
  where deleted_at is null;

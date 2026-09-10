do $$
begin
  create role farmies_api
    nologin
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;
exception
  when duplicate_object then null;
end
$$;

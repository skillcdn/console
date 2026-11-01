create table tallies (
  id bigint generated always as identity primary key,
  note text not null default '',
  at timestamptz not null default now()
);

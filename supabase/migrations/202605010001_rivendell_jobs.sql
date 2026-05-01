create table if not exists rivendell_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  status text not null check (status in ('queued','running','needs_review','done','failed','cancelled')),
  skill text not null,
  source text,
  source_ref text,
  repo text,
  prompt text,
  result jsonb,
  error text,
  needs_review_reason text,
  approved_at timestamptz,
  completed_at timestamptz
);

create table if not exists rivendell_job_events (
  id bigint generated always as identity primary key,
  job_id uuid references rivendell_jobs(id) on delete cascade,
  ts timestamptz default now(),
  level text,
  text text,
  payload jsonb
);

create index if not exists rivendell_jobs_status_created_idx
  on rivendell_jobs (status, created_at);

create index if not exists rivendell_job_events_job_ts_idx
  on rivendell_job_events (job_id, ts);

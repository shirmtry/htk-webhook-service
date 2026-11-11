export type Migration = { version: number; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      create table users (
        id text primary key,
        email text not null unique,
        name text not null,
        password_hash text not null,
        created_at timestamptz not null default now()
      );

      create table sessions (
        id text primary key,
        user_id text not null,
        expires_at timestamptz not null,
        created_at timestamptz not null default now()
      );

      create table endpoints (
        id text primary key,
        user_id text not null,
        slug text not null unique,
        name text not null,
        target_url text not null,
        mode text not null default 'sandbox' check (mode in ('sandbox','live')),
        secret text not null,
        previous_secret text,
        secret_rotated_at timestamptz,
        rate_limit_per_min integer not null default 60,
        max_attempts integer not null default 5,
        status text not null default 'active' check (status in ('active','paused')),
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table events (
        id text primary key,
        endpoint_id text not null,
        idempotency_key text not null,
        event_type text not null,
        payload text not null,
        status text not null default 'queued' check (status in ('queued','delivered','dlq')),
        source text not null default 'ingest' check (source in ('ingest','test','replay')),
        attempts integer not null default 0,
        next_attempt_at timestamptz not null default now(),
        last_status_code integer,
        last_error text,
        received_at timestamptz not null default now(),
        delivered_at timestamptz,
        unique (endpoint_id, idempotency_key)
      );

      create table deliveries (
        id text primary key,
        event_id text not null,
        attempt_no integer not null,
        outcome text not null check (outcome in ('success','retry','fatal')),
        status_code integer,
        response_body text,
        duration_ms integer not null default 0,
        error text,
        started_at timestamptz not null default now()
      );

      create table audit_logs (
        id text primary key,
        actor_id text,
        action text not null,
        target text not null,
        detail text,
        created_at timestamptz not null default now()
      );

      create table request_logs (
        id text primary key,
        method text not null,
        path text not null,
        status integer not null,
        duration_ms integer not null,
        created_at timestamptz not null default now()
      );

      create table rate_limits (
        key text primary key,
        window_start bigint not null,
        count integer not null
      );

      create index idx_endpoints_user on endpoints (user_id, created_at desc);
      create index idx_events_endpoint on events (endpoint_id, received_at desc);
      create index idx_events_due on events (status, next_attempt_at);
      create index idx_deliveries_event on deliveries (event_id, attempt_no);
    `,
  },
];

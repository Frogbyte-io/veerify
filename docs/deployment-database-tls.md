# Database TLS

The runtime app, Drizzle migrator, and domain backfill share one PostgreSQL
connection policy.

- `DATABASE_SSL_MODE` accepts only `disable` and `verify-full`. An invalid value
  fails startup/migration rather than silently choosing a weaker setting.
- A production `DATABASE_URL` defaults to `verify-full` when the mode is unset.
  Local development URLs and all `PG*`-variable connections retain the existing
  non-TLS default. Remote `PG*` connections must explicitly set
  `DATABASE_SSL_MODE=verify-full`.
- `DATABASE_SSL_CA` is an optional PEM CA used with `verify-full`; system trust
  roots are used when it is omitted. A CA paired with `disable` is rejected.
- SSL query parameters in `DATABASE_URL` (including provider defaults such as
  `sslmode=require`) and `PGSSLMODE` cannot override the resolved policy. They
  are normalized away before the shared host configuration is passed to
  node-postgres.
- URL query parameters are limited to connection identity (`host`, `port`,
  `user`, and `password`) plus the SSL parameters above. Unsupported options
  such as `application_name` are rejected rather than silently dropped.

Do not place connection URLs, credentials, or CA contents in logs. For a
private provider CA, set the PEM value as a protected deployment secret.

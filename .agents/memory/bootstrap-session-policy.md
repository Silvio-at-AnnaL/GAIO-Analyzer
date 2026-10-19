---
name: Bootstrap and session ownership
description: Product-owner boundaries for database connection configuration and session-secret adoption.
---

Database connection configuration belongs outside the application: an explicit DATABASE_URL takes priority over the own-server bootstrap file. Do not restore an editable database connection setting or implicit connection defaults.

**Why:** The user explicitly required honest read-only Admin → Server status of the real pool, without application-managed connection strings.

**How to apply:** Preserve the distinction between reporting/testing the active pool and configuring its credentials.

Session signing adopts the configured environment secret only when creating its dedicated database setting. Existing legacy JWT/session-secret settings must not be reused, changed, or deleted.

**Why:** The user deliberately requested a new, independently owned signing-secret setting and explicitly prohibited adopting legacy settings.

**How to apply:** Keep stored-value precedence across restarts and instances. Future migrations must not reinterpret legacy secret rows as the signing source.

---
name: Live session identity
description: Product-owner decision to resolve authorization identity from current account data on every protected request.
---

After token verification, protected requests must resolve the account's current role and username from the database every time. Do not cache this lookup or fall back to identity claims in the JWT. Deleted accounts invalidate the session cookie; database errors must fail closed.

**Why:** The product owner requires role changes and account deletion to take effect on the next request, rather than allowing old role claims to remain effective until the eight-hour JWT expires.

**How to apply:** Preserve this boundary in future authentication or permission work. The JWT identifies which account to look up; it is not the authority for the account's current privileges.

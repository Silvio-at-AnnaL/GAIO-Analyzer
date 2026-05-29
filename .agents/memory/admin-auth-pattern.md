---
name: Admin auth pattern (frontend)
description: How admin views make authenticated API calls — cookie-based, not Bearer token.
---

**Pattern:** Import and use `adminFetch` from `@/store/authStore`:

```typescript
import { adminFetch } from "@/store/authStore";

const res = await adminFetch("/api/admin/some-route");
const data = await res.json();
```

`adminFetch` uses `credentials: "include"` (httpOnly cookie session). No Bearer token required.

**Why:** The backend uses session cookies for admin auth, not JWT in Authorization headers. `useAuth()` does NOT expose a token field. Using a custom fetch with `Authorization: Bearer ${token}` will fail with a type error and also not work at runtime.

**How to apply:** Any new admin view that needs to call `/api/admin/*` endpoints should use `adminFetch`, never a raw `fetch` with a token.

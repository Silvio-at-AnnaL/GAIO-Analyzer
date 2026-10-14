---
name: Nondelegable admin permissions
description: Product-owner policy distinguishing delegable features from actions that must remain administrator-only.
---

User management, permission editing, and database configuration/testing are admin-only and never delegable, regardless of role grants stored in the permission map. The user-management and permission-management feature entries must be saved as administrator-only.

**Why:** The product owner explicitly requires these actions to remain "Admin-only, never delegable," even when stored permissions list other roles.

**How to apply:** Preserve these boundaries in future permission changes. Reading the permission map remains available to every authenticated user because the navigation menu needs it; that is distinct from editing permissions.

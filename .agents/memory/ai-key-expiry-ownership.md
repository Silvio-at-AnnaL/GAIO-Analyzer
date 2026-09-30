---
name: AI key expiry ownership
description: How the single configured key-expiry date relates to the active AI key.
---

The single AI key-expiry date belongs to the currently active API key, not to the provider identity. Clear it when changing the active provider or replacing the currently active built-in or custom provider's actual API key. Do not clear it for unchanged, masked, or inactive-provider keys.

**Why:** The user explicitly chose one expiry setting and clarified that a date from a prior key must not be shown for a new active key.

**How to apply:** When updating AI settings or adding alternate provider-management paths, keep key and expiry changes synchronized and refresh both the admin view and sidebar warning.
---
name: Stored prompt ownership
description: Why prompt-default changes do not imply modifying an existing admin-managed prompt.
---

Treat admin-stored prompts as production data. Do not automatically replace an existing prompt when changing its code default; obtain explicit permission for any such data change.

**Why:** The user deliberately kept an existing English FAQ prompt unchanged while introducing a German default. Live analyses therefore continued to use the English prompt and could not satisfy the new German response parser; that outcome was accepted until a person resets the stored prompt via the admin UI.

**How to apply:** When a default template changes, check whether a stored version takes precedence. Verify the new default independently if necessary, distinguish that test from the currently active runtime behavior, and report any remaining manual activation step.
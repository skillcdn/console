---
"@skillcdn/console": patch
---

`PATCH /api/v1/me` and `PATCH /api/v1/workspace` read at most 256 KiB, as the rest of the API does, and answer `request.too_large` past it.

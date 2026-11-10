---
"@skillcdn/console": patch
---

The template of an agent account's desk (ADR-0088): `deskFiles` in `@skillcdn/console/runner` writes the five files a desk begins with, `README.md` for people, `AGENTS.md` with the base instructions in eight sections, `CLAUDE.md` pointing a product to them, `runner.json` and `.gitignore`, from the account, the console and the services the workspace names (`deskServicesOf`). What a persona says is written as text and makes no markup. `examples/agent-desk` in the console's repository is what it writes for an invented account.

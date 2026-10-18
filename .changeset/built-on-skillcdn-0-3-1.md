---
"@skillcdn/console": patch
---

The package is built on SkillCDN 0.3.1: `@skillcdn/core`, `@skillcdn/client`, `@skillcdn/indexer`, `@skillcdn/reader` and `@skillcdn/brand` are taken at 0.3.1, which brings the contract of a command connecting to a deployment with a code a person approves (its ADR-0059: the routes under `/api/v1/connect`, their schemas, `parseConnectCode` and `connectPagePath` in `@skillcdn/core`; `connect`, `claimConnection`, `connection` and `decideConnection` in `@skillcdn/client`); nothing of the console reads it yet.

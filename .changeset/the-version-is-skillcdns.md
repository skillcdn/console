---
"@skillcdn/console": patch
---

The package's version is read as SkillCDN's (ADR-0032): its major and minor are those of the one version the main repository's packages share, 0.3 for this release, its patch the console's own; the packages it is built on, `@skillcdn/core`, `@skillcdn/indexer`, `@skillcdn/reader`, `@skillcdn/client` and `@skillcdn/brand`, are taken at that one version. A release whose entry starts with `Breaking:` changes or removes something that exists; every other release changes nothing that exists.

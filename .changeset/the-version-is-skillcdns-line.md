---
"@skillcdn/console": minor
---

The package is versioned on SkillCDN's line from here on (ADR-0034): the major and the minor are those of the one version of the main repository's packages the console is built on, `0.3` for this release, and the patch is the console's own, so `@skillcdn/console` 0.3.x is the console for SkillCDN 0.3. Within a line every release is a patch, whose entry starts with `Breaking:` where it changes or removes something that exists; the next line of SkillCDN is a minor. The packages the console is built on, `@skillcdn/core`, `@skillcdn/indexer`, `@skillcdn/reader`, `@skillcdn/client` and `@skillcdn/brand`, are taken at one version, SkillCDN 0.3.0 here.

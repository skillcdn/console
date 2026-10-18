---
"@skillcdn/console": patch
---

A workspace is named by convention: the organization or the person the console is for, then Console, as SkillCDN Console is named. The skill deploying-a-console (1.4) suggests the name from the request or the organization's website and has the person confirm it, never inventing one; building-a-console (1.5) and the deploy README say the same of `WORKSPACE_NAME`. When the console connects a pack at SkillCDN it calls itself by the workspace's name with Console after it once, never `Acme Console console`.

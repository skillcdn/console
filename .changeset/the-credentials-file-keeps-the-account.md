---
"@skillcdn/console": patch
---

The credentials file keeps what a login was kept with: whether the command is signed in as the account itself (`console login --self`), and the time zone of the workspace. The file store wrote neither back, so `console agent setup` run again on a machine asked for the browser sign-in again where the spec says it signs in nowhere, `console logins` never said "as the account itself", and every moment the command printed was in UTC whatever zone the workspace keeps.

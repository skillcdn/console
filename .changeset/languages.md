---
"@skillcdn/console": patch
---

The pages speak the person's language (ADR-0012). Every word the default console shows is in a language pack; English and Korean ship with the package (`ENGLISH`, `KOREAN`, `DEFAULT_LANGUAGES`), the browser's languages choose before the person does, and the person's choice, switched from their menu, is kept on them (`PATCH /api/v1/me`, `client.updateMe`, `me.language`). A component takes its words from the language above it (`useWords`, `LanguageContext`), English where there is none; `createConsole({ languages })` replaces the packs a console speaks; `Shell` takes `languages` and `onLanguage`; `describeEvent` takes the words to say it in; `formatInstant` takes the language. The English label constants (`STATE_LABELS` and the rest) stay as the default words. The command stays English.

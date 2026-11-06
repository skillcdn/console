---
"@skillcdn/console": patch
---

`console-plugin init` takes beside the key what a plugin bound for a repository or a registry was adapted to by hand: `--package <name>`, the package's name, a scoped one published as public; `--repository <url>` with `--directory <path>` in a repository of several plugins, which fill `repository`, `homepage` and `bugs` and the manifest's `store`; and `--languages en,ko`, the languages of the plugin's words, which gives every language map of the manifest and the translations of `SKILLCDN.md` and of the skill the other languages as English words to translate. `console-plugin check` warns of a translation left the same as English. The template names its package as `__package__`; `isLanguageMap`, `LANGUAGE_TAG`, `PACKAGE_NAME` and `sameAsEnglish` are exported with the command's modules.

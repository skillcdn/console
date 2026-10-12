---
"@skillcdn/console": patch
---

The rules say the person's language, a token gives itself up, and the settings pages are tidied.

- **The rules** may say `{language}` for the language of the person an agent works for: `console rules` and `console take` fill it with the name of the language the person chose for the pages (`GET /api/v1/me`), or with the task's language when they chose none, and `RulesView` fills it with the language the pages speak; the API answers the text as written. The console's own rules say so where they speak of reports, and no longer repeat what every agent does with code and commits. `fillRules`, `languageNameOf` and `RULES_LANGUAGE_PLACEHOLDER` are exported.
- **Back to the console's own:** the console's own rules saved as they stand while the organization's are written put the organization's page away rather than copy it (`PUT /api/v1/rules`); the settings offer "Reset to the console's rules" on the page and on the form (`RulesForm` takes `onReset`).
- **`console logout`** gives the token up at the console (`DELETE /api/v1/me/token`, `client.giveUpToken()`) and forgets it; a console out of reach leaves the token to the Agents page, and the person is told so.
- **An agent's name:** `console login` without `--agent` names the agent it runs under where its environment says so (Claude Code, Codex), else "An agent", with the machine after it ("Claude Code on a laptop"); the pages show the name before "on" and the whole on hover (`agentLabel`).
- **The pages:** a project that is not private is marked "Open to everyone" wherever projects are listed; a project's settings keep its facts in one list with its description among them, and fold the workspace's rules under where they come from; the Skills page says when the console could not reach SkillCDN instead of loading on, and the console answers `unavailable` rather than failing when the deployment stops answering half-way. Words: `rules.read`, `projects.public`; classes `sc-facts-plain`, `sc-facts-wide`, `sc-section-head`, `sc-rules-actions`, `sc-rules-fold`.

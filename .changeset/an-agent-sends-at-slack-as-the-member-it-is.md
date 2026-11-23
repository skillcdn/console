---
"@skillcdn/console": patch
---

An agent account's setup has it send at Slack as the member it is, and be there at every hour. The messenger's MCP server puts a line that names the product under whatever it sends, so the manifest the skill `running-an-agent` carries asks for the member's own `chat:write` and `files:write` beside the scopes that wake the agent: a message or a file sent with the token the installation hands back carries the agent's name and nothing else. The skill says how: a message as `markdown_text`, since the messenger's own marks in `text` break beside a letter of Korean, and the MCP server for reading alone, so that the app asks for no scope to read with. It has the agent set its working hours to every hour of every day too: outside a new member's hours the messenger pauses its notifications and shows it as paused.

The onboarding task of a new account says the same in its items for Slack, and names where the token is kept, `slack.user_token`; `console secret slack.user_token --set` says when the value is not a member's token (`xoxp-`), as it does of the app-level one.

An account set up before adds the two scopes to its app's manifest, installs the app again, keeps the member's token as `slack.user_token` and sets its working hours. Nothing changes for it until it does.

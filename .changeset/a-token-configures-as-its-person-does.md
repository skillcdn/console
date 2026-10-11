---
"@skillcdn/console": patch
---

A token configures as its person does ([ADR-0021](https://github.com/skillcdn/console/blob/main/docs/adr/0021-a-token-configures-as-its-person-does.md)).

- **The command.** Six commands for what an administrator or an owner does on the pages, so that an agent sets up what it is told to instead of handing its person a list of clicks: `people` and `person role <login> <admin|member>`; `project <key>`, `project new <key> "<name>"`, `project edit <key>` and `project icon <key> <file>|--remove`; `members`, `member add|role|remove <login>`; `category new|edit|remove <key>`. `console help` lists them under "Configuring, as the person", each with its limits and its refusals by code; the console decides with the same roles as on the pages, and refuses with `auth.forbidden` where the person may not. The tokens themselves have no command, by design.
- **The client.** Every call a session may make, a token may make, within the person's roles: `createProject`, `updatePerson`, a project's `update`, `setIcon`, `addMember`, `updateMember` and `removeMember`, `createCategory`, `updateCategory`, `removeCategory`, and `updateMe` for the language; what they write names the agent beside the person. Only the tokens themselves, and the approval of a connection, stay a session's (`auth.session_required`).
- **The default UI.** A console of a person's own, served on a token, offers the new project, the settings, the members, the categories and the people's roles as the organization's console does, and keeps the choice of language on the person rather than in the browser; only the Agents pages stay on the organization's console, signed in.

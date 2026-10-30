# Setting up: the commands, and the standing each needs

What an administrator or an owner does on the pages, their agent does here with the same standing, named beside them on the feed ([ADR-0021](/docs/adr/0021-a-token-configures-as-its-person-does.md)). What the person may not, the console refuses (`auth.forbidden`): that step goes back to them in the account, with who may do it, never worked around. `console help <command>` says every flag, limit and refusal; this page says which command does what, and who may.

## The project, for an administrator to make and an owner to keep

- **Made:** `console project new <key> "<name>" [--description <markdown>] [--visibility workspace|private] [--skills <address>] [--color <name>] [--symbol <text>]`, by an administrator alone ([ADR-0045](/docs/adr/0045-a-project-is-made-by-an-administrator.md)), who is then its owner. Private unless `--visibility workspace` says everyone of the workspace works in it. The key is lowercase letters, digits and hyphens and does not change once made: chosen with the person, and `project.key_taken` is not guessed around. The organization's skills are the project's unless `--skills` names an address of its own.
- **Changed:** `console project edit <key> [--name "<name>"] [the same flags; none clears]`, for an owner; its mark, `console project icon <key> <file>` (a PNG, JPEG, GIF or WebP) or `--remove`.
- **Read:** `console project <key>` in full; `console projects` lists those the person may work in, with what they are in each.

## The members, for an owner

`console member add <login> [--role owner|member] [--project <key>[,<key>...]]`, `console member role <login> <owner|member>`, `console member remove <login>`; `console members` lists them. A login is matched as typed, so a person the list hides (where who sees whom is narrowed) is still listed by their login. In a project open to the workspace everyone is a member already: `member add <login> --role owner` lists an owner, `member role <login> member` takes the listing back, and a plain `member add` is refused (`member.open_project`).

## The categories, for an administrator

`console category new <key> "<name>" [--color <name>]`, `console category edit <key> [--name "<name>"] [--color <name>]`, `console category remove <key>`; `console categories` lists them, the same in every project. A category tasks or goals are sorted into stays until they are moved (`category.in_use`: `console task edit <number> --category <other|none>` moves one). Colours: gray, blue, green, orange, pink, purple, teal, yellow.

## The people, for an administrator

- `console person role <login> <admin|member>`: what a person is in the workspace; the board keeps at least one administrator in (`person.last_admin`).
- `console person add <login> [--host gh|google]` lets a login in: whoever signs in with that account at that host is a person from then on; the host is read off the login (an address is Google's, anything else GitHub's) unless `--host` says. `console person remove <login>` takes a login away that nobody has signed in with yet.
- `console person deactivate <login>` takes a person out: refused on every request at once, their agents with them, kept with everything they did, and listed nowhere ([ADR-0044](/docs/adr/0044-a-token-of-a-person-who-is-out-is-kept-and-refused-with-the-reason-until-they-are-back-in.md)); `console person reactivate <login>` takes them back in. A person the organization let in, through its domain or its organization at the git host, comes and goes with it (`person.of_organization`).
- `console people` lists the people the person sees, by login, with what each is, and the logins let in that nobody has signed in with yet.

## The workspace, for an administrator

`console workspace` says its settings; `console workspace edit` changes them ([ADR-0035](/docs/adr/0035-who-may-see-whom-is-decided-by-one-policy-and-the-workspace-keeps-its-settings.md)): `--people-visibility <everyone|shared-projects>`, who sees whom on the People page and in the pickers; `--week-start <auto|monday|sunday>`, the day the calendars begin a week on; `--time-zone <zone|none>`, an IANA name such as `Asia/Seoul`, in which the command prints moments from then on.

## The rules, for an owner or an administrator

`console rules` reads what holds: the workspace's rules, the console's own until an administrator writes the organization's, and the project's own. `console rules write --file <path>` writes the project's, for an owner, from [the example](project-rules.md); with `--workspace`, the organization's, for an administrator, starting from the console's own as `console rules` prints them; `none` puts the written rules away, so that the console's own hold again. Written only when a person asked for exactly that, and never to loosen what they ask of agents: every agent reads them.

## The goals, for an owner

`console goal new "<title>" [--body <markdown>] [--state <state>] [--category <key>] [--starts <day>] [--due <day>]` sets a goal on the roadmap; `console goal edit <id> [the same flags; none clears a category or a day]` changes one; `console goals` lists them, `--search <words>` by the words of a title; `console task archive --goal <id>` puts every done or dropped task of a goal away at once.

## A private pack, for an owner or an administrator

A project whose skills are a private repository holds a SkillCDN token the console reads them with ([ADR-0028](/docs/adr/0028-the-console-reads-a-projects-pack-through-the-deployments-rest-api-with-a-pack-token-for-a-private-one.md)): `console project pack-token <key> --connect`, for an owner; for the organization's pack, which every project reads that names no address and holds no token of its own, `console workspace pack-token --connect`, for an administrator ([ADR-0036](/docs/adr/0036-a-private-pack-is-connected-with-a-code-a-person-approves-from-the-projects-settings.md)). The command prints a page at SkillCDN and a code, which the agent relays; the person approves there, signed in as someone who may open the repository, and the console keeps the token, shown to nobody. `--stdin` reads a token a person made by hand at SkillCDN from standard input, never an argument; `--remove` takes it away. Until a token is set, `console skills` says the pack is not served to the console.

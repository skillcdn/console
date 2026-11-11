# ADR-0094: The account an agent signs in with is named, and who makes it is the organization's to say

- Status: Accepted
- Date: 2026-11-12
- Amends [ADR-0088](0088-an-agent-account-has-a-desk-and-is-set-up-from-an-invitation-by-signing-in-as-itself.md), points 4 and 6, under which the account's page said what a person does first in the words of the identity service's module, and a git-host account was asked for with the host's terms as the reason; and [ADR-0089](0089-a-workspace-names-the-services-its-agents-work-with.md), point 3, under which a module said in the guide that a service asks that a person make an account. Everything else of both stands: the invitation, the guide its code opens, the three roles, a decision for what the agent cannot do, a module per kind of service.

## Context

"Add an agent account" said, in a box under the login: a person makes this account at the provider, and the host's terms ask that a person register an account. The account's settings said the same at more length, in English on a Korean page, since the words came from the service's module. Reading the pages, two things were wrong with it.

It was not the page's to say. Whether a person or an agent makes an account at a provider is the organization's own business: an organization whose directory is kept by an agent has that agent make the user, and a provider's terms are read by whoever accepts them. A console that states them takes a side it has no standing to take, and is wrong the day a provider changes them.

And it buried what the page is for. The one thing "Add an agent account" must get right is the account the agent signs in to the console with, an address at Google Workspace or a login at the git host, since the console lets in that login and no other. A paragraph on who makes it stood where the form should say what kind of name it is and when the account has to be there.

What a setup needs of a person was also said in the wrong place. The account's sign-in is needed once, on the machine, when the command signs in as the account. The console's other skills have an agent ask the person for what it lacks, in words; the setup had a page tell a person in advance.

## Decision

1. **The console says what has to be there, never who makes it.** No page, command, guide or task of the console's states who makes an account at a service or what a service's terms ask. A module says what an agent needs at its service before it starts, as things that are there: the account by its name, made if it is not there yet; an invitation to an organization; what the account signs in with at hand. A fact about a service that decides how an agent holds an account there, a service account that signs in at no page, is still said.
2. **"Add an agent account" is about the account it signs in with.** The form is in three parts: who the account is, a persona chosen and edited; the account it signs in with, at one of the providers the deployment has, put together from the workspace's services and edited freely; whom it reports to and where it starts. Under the login it says what kind of name it is, an address or a login, that the agent signs in as it through that provider, and that the account need not be there yet and has to be before its machine is set up.
3. **The account's page says what is next, in order.** Until its runner is heard from, an account's page shows four steps in place of a session: the account it signs in with, by its login and its provider; an invitation, made there; the one line on its machine; its runner. Each is said done as the console sees it: someone signed in with the account, an invitation stands, its command is signed in, its runner was heard from. What the console cannot see, that the account is there at its provider, it does not claim; once a later step is done the one after it is next. The words are the pages' own, in every language of the packs.
4. **The setup has the agent ask for the sign-in.** The guide's part for the machine begins with what the agent says to the person there, in words it can say as they are: which account it is being set up as, the exact login the console signs it in with and through which provider, whether that account is there, that it be made where it is not, and that the person signs in as it when the browser opens or hands over what it signs in with. It waits for the answer, never signs in as anyone else and never makes up a login.
5. **A sign-in at a page is the agent's own, kept in the machine's own browser.** The guide, the onboarding task and the skill say how an agent signs in at the services it works with: with a browser tool of its product that attaches to the ordinary browser of its OS account, where a sign-in stays from one session to the next; where a sign-in wants a person, a code sent to a phone or a picture to solve, a person signs in inside the agent's session, over a remote desktop or at the machine, and leaves; and nothing the agent signs in with is ever sent in a message, a task or a comment.
6. **What the agent cannot do itself is still a decision,** addressed to whoever can do it and to its manager where it does not know who (ADR-0088, point 6). It is worded as what is missing, "the account `acme-mira` at GitHub, where you cannot sign in as it", and never as what only a person may do.

## Consequences

- `AgentAccountForm` loses its box and gains its parts; `AgentInvitationPanel` no longer takes the lines of a module (`first`) and takes `intro`; `AgentStartSteps` is new. The words `accounts.form.first` go from the packs, and the steps' words come in both languages.
- The modules' `guide` and `asks` are worded again, and their tests hold that none says who makes an account or names a provider's terms.
- The guide has a part more, "Signing in elsewhere, in a browser", and its part for the machine a step more, first; `SetupGuideSection.key` gains `browser`.
- `console agent new` says the login the account signs in with and when it has to be there.
- A provider's terms may well ask that a person register an account. An organization that follows them has a person do it; the console neither helps nor hinders, and an agent that asks "is that account there?" is told by whoever knows.
- Nothing here changes who may do what: an administrator makes the account, a supervisor makes the invitation, and the account is entered through its own sign-in alone.

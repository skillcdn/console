# ADR-0087: An agent account keeps its secrets in a store of its own that only it reads

- Status: Proposed
- Date: 2026-11-10
- Follows [ADR-0084](0084-an-agent-account-is-a-member-of-its-own-with-a-manager-above-it.md). Keeps the console's sealing as a plugin's secrets have it ([ADR-0070](0070-a-secret-is-sealed-by-the-console-from-an-answer-and-goes-where-its-setting-says.md), [ADR-0075](0075-a-secret-never-comes-back-to-a-plugin-and-sealing-fails-closed.md)), and the rule that no git-host token or other person's credential ever reaches an agent ([AGENTS.md](../../AGENTS.md), rules 3 and 4).

## Context

An agent account holds accounts elsewhere as a person does: a mailbox, a git-host account, a messenger membership, an OS password, perhaps a long-lived token for its model. A person keeps theirs in a password manager; an agent's would be on a machine that may be lost, or in files a tool reads and may print. Its manager should not have to hold them, since a key held by a person is a key to rotate when the person leaves and a reason to hold the person responsible for what the agent did with it. And when a machine is lost, the agent must be set up again from nothing but a new enrollment.

## Decision

1. **The console keeps a secret store per agent account:** named values, sealed with the console's server-side key as the pack tokens are. A name is `[a-z0-9._-]`, up to 64 characters (`os.password`, `git.token`, `mail.password`, `claude.oauth_token`); a value up to 8 KiB; up to 200 per account.
2. **The owner reads, writes and deletes; a supervisor seeds and deletes, never reads.** The agent account, through its token, has `console secret set | get | ls | rm` (`GET`, `PUT`, `DELETE /api/v1/agents/me/secrets/<name>`), the value typed unseen or from a file, never on the command line. A supervisor (ADR-0084, point 4) has `console agent secret seed <handle> <name>` (`PUT /api/v1/agents/<handle>/secrets/<name>`), write-only, so that a person or a parent agent can bootstrap an account and hand it a credential the agent cannot make for itself, and `console agent secret rm`, and may list the names. Every access is an event naming the secret and never its value: `agent.secret_set`, `agent.secret_read`, `agent.secret_removed`, with the actor and, for a seed, that it was seeded.
3. **The runner materializes secrets only for the session.** The runner's configuration (ADR-0088) maps names to environment variables and files; at session start the runner reads them with the agent's token and writes files with mode 600 in the agent's own account, removes them at session end, and redacts their exact values from the transcript before upload (ADR-0086). The OS password is used through a `SUDO_ASKPASS` helper the runner writes, so that it never stands on a command line.
4. **sudo is on by default.** The agent administers the machine it runs on: its OS account is an administrator, and installing tools, updating them and running services is its own doing. The OS account separates identity, sessions and credentials from other agents on the machine, not security; an organization that shares a machine between agents of different trust runs them without sudo, where user-space installs serve and the rest is a decision to the manager.

## Consequences

- No manager holds a key for an agent; a lost machine is recovered with a new invitation code and `console agent setup` (ADR-0088), which pulls back what the account needs; a secret is on a disk only while a session runs.
- The agent's console token reads all its secrets, so the token is the thing to protect: it expires, a supervisor revokes it at once, and every read is an event its supervisors see. The transcript never carries a materialized value, and sealing (ADR-0086) covers what slips through by another way.
- What a secret is for is the agent's business: the console seals bytes under a name and never sends them anywhere itself, unlike a plugin's secret, which the console puts into a request.
- Rejected: a password manager of the agent's own on the machine, which is lost with the machine and read by nobody when the agent is gone; recovery codes and keys held by the manager, which the manager must rotate and be answerable for; secrets as files in the desk repository, which a tool would print and a push would publish; supervisors reading a secret, which no event could make safe.

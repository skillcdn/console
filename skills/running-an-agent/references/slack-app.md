# The app that wakes an agent at Slack

An agent account is a member of the messenger as a person is, with its own address and its own name. To be woken by what is said to it there, it has an app of its own: one app for one agent account, installed by the agent as itself, which receives over Socket Mode the events the agent's own member can see. The runner's `slack` wake source listens on it ([the runner's specification](/docs/specs/runner.md#wake-sources)).

The app reads and sends nothing for the agent: the agent reads and writes at the messenger with the messenger's own MCP server, added to its product. The app only says that something was said.

## The manifest

Made at the messenger's page for apps, "From a manifest", in the workspace the agent is a member of, signed in as the agent. Put the agent's handle in place of `mira`.

```yaml
display_information:
  name: mira wakes
  description: Wakes the agent account mira of the console when it is spoken to.
oauth_config:
  scopes:
    user:
      - im:history
      - mpim:history
      - channels:history
      - groups:history
settings:
  event_subscriptions:
    user_events:
      - message.im
      - message.mpim
      - message.channels
      - message.groups
  socket_mode_enabled: true
  org_deploy_enabled: false
  token_rotation_enabled: false
```

The scopes are the member's own, not a bot's: the app sees the conversations the agent is in, and no other. A workspace whose administrators approve apps asks one of them to approve it; that is asked as a decision on the board, of whoever administers the messenger.

## The token

1. On the app's own settings, under its basic information, make an app-level token with the scope `connections:write`. It begins with `xapp-`.
2. Keep it in the account's store, and nowhere else: `console secret slack.app_token --set`, with the token typed unseen or piped in, never as an argument.
3. Install the app to the workspace, as the agent. The token the installation hands back is the member's own, and the wake source does not need it: do not keep it unless something else of yours does.

## The runner

Add the source to `wake` in the desk's `runner.json`, and commit it:

```json
{ "wake": ["console", "slack"] }
```

The runner reads `runner.json` when it starts, so the change is taken when the runner is next started: when the agent's OS account next logs in, or when whoever administers the machine starts its service again. A supervisor's restart of the agent starts its session again, not its runner. The runner's lines then say `the slack wake source is connected`, and a direct message or a mention of the agent arrives as a wake from the messenger, with the thread as its key.

## What wakes the agent, and what does not

- A message in a direct conversation with the agent, and a message anywhere the agent is that mentions it, from anyone but the agent itself.
- Not what is said in a channel without naming it, not an edit, a join, a deletion or a reaction, and nothing the agent said.

A wake carries where it was said, by which member, and the message's words as someone else's, cut where they are long. The agent reads the thread with the messenger's own tool before it answers there.

## Not seen run yet

This is written from the messenger's documentation of app manifests, Socket Mode and the Events API. Where the messenger's pages say otherwise, they are right: say so in a report on the onboarding task, with what the page showed.

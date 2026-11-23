# The app of an agent account at Slack

An agent account is a member of the messenger as a person is, with its own address and its own name. It has an app of its own there, one app for one agent account, installed by the agent as itself, for two things: to be woken by what is said to it, and to send as the member it is. The app receives over Socket Mode the events the agent's own member can see, and the runner's `slack` wake source listens on it ([the runner's specification](/docs/specs/runner.md#wake-sources)); the token it holds for the member is what the agent sends with ([Sending](#sending)).

The app reads nothing for the agent: the agent reads at the messenger with the messenger's own MCP server, added to its product.

## The manifest

Made at the messenger's page for apps, "From a manifest", in the workspace the agent is a member of, signed in as the agent. Put the agent's handle in place of `mira`.

```yaml
display_information:
  name: mira wakes
  description: Wakes the agent account mira of the console when it is spoken to, and sends what mira writes.
oauth_config:
  scopes:
    user:
      - im:history
      - mpim:history
      - channels:history
      - groups:history
      - chat:write
      - files:write
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

The scopes are the member's own, not a bot's: the app sees the conversations the agent is in, and no other, and what is sent with its token is the member's own message, under the agent's name and picture, with no app named beside it. They are the least that waking and sending take: the four that end in `history` for the events, `chat:write` for a message and `files:write` for a file or a picture. Add none to read with, for a search, a profile or a list of channels: the MCP server reads, and a token that leaked does no more than its scopes allow. A workspace whose administrators approve apps asks one of them to approve it; that is asked as a decision on the board, of whoever administers the messenger.

## The tokens

The app has two. Each is kept in the account's store, and nowhere else, typed unseen or piped in, never as an argument.

1. On the app's own settings, under its basic information, make an app-level token with the scope `connections:write`. It begins with `xapp-`, and the wake source reads it: `console secret slack.app_token --set`.
2. Install the app to the workspace, as the agent. The token the installation hands back is the member's own and begins with `xoxp-`. The wake source does not need it; the agent sends with it: `console secret slack.user_token --set`.

An app made before the manifest asked for the two scopes to send with: add them to its manifest on the app's own settings, install the app again as the messenger then asks, and keep the member's token after that.

## Sending

The agent sends with the messenger's Web API and the member's token, and never with the MCP server: what the server sends carries a line of its own under the words, which names the product it was sent with, and no setting takes the line away. What the member's token sends carries the agent's name and nothing else, as any member's message does.

- **A message** is `chat.postMessage`: `channel`, the id of the conversation, as the wake's first line names it; `thread_ts`, the thread the wake names, where the answer belongs in one; and the words as `markdown_text`, in Markdown as it is written everywhere (`**bold**`, a list, a link), 12,000 characters at most, with no `text` beside it. Not as `text`: of the messenger's own marks there, one that a letter follows at once is shown as it was written, so `*bold*` keeps its asterisks in Korean, where a particle follows its word with no space.
- **A file or a picture** takes three steps: `files.getUploadURLExternal` with the file's name and its length in bytes, which answers an address and an id; the file's bytes, sent to that address; and `files.completeUploadExternal` with the id in `files`, the conversation as `channel_id`, the thread as `thread_ts`, and a few plain words to go with the file as `initial_comment`. What is to read as Markdown goes in a message of its own.
- **The token** goes in the `authorization` header of each call of a method, read from the store as the call is made (`console secret slack.user_token`). It is written into no file of the desk and into no command's own words, which every account of the machine can read while the command runs: a script of the agent's own in its desk, which reads the token when it runs, holds to both.

## Working hours

The messenger gives a new member working hours, the weekdays from nine to five. Outside them it pauses the member's notifications and shows it on its profile as paused until the next morning, which reads as a member who is away. An agent account is there at every hour: in the member's preferences, under Availability, set Working hours to every day, from 12:00 AM to midnight. No call of the API sets them: it is done on the messenger's own pages, in the browser, signed in as the agent.

## The runner

Add the source to `wake` in the desk's `runner.json`, and commit it:

```json
{ "wake": ["console", "slack"] }
```

The runner reads `runner.json` when it starts, so the change is taken when the runner is next started: when the agent's OS account next logs in, or when whoever administers the machine starts its service again. A supervisor's restart of the agent starts its session again, not its runner. The runner's lines then say `the slack wake source is connected`, and a direct message or a mention of the agent arrives as a wake from the messenger, with the thread as its key.

A channel the agent is to follow without being named each time, one it works in say, is named in `channels`, by the id the messenger gives it (in the channel's details, or the last part of its link), never by its name:

```json
{ "wake": ["console", "slack"], "channels": ["C0123ABCD"] }
```

The agent adds one when it, or whoever manages it, chose the channel, and takes it out again when the talk there is not for it: every message a person writes there starts a turn.

## What wakes the agent, and what does not

- A message in a direct conversation with the agent, and a message anywhere the agent is that mentions it, from anyone but the agent itself.
- What a person says in a group conversation the agent is in, and in a channel `channels` names, whether it names the agent or not.
- Not what is said in any other channel without naming it, not what an app posted in a group conversation or a channel without naming it, not an edit, a join, a deletion or a reaction, and nothing the agent said.

A wake carries where it was said, by which member, and the message's words as someone else's: what the message shows, with a table as rows between bars and a list, code and a quote as the messenger writes them in a message's text. What it does not carry of a message, a picture or a button, stands in the words where it was (`[image, not carried in this wake]`), and words longer than 4,000 characters are cut: the wake's first line then says so, with the moment of the message to read whole. The agent reads the thread with the messenger's own tool before it answers there, and the message itself wherever its wake says that something of it is missing.

## Not seen run yet

This is written from the messenger's documentation of app manifests, Socket Mode, the Events API, a message's blocks and the Web API's methods for a message and a file. Sending with the member's token was seen in a workspace on 2026-11-23, a message as `markdown_text` and a picture put in a direct conversation by the three steps, with words to go with it: each was the member's own, with no line under it. A member's working hours were seen there too. Where the messenger's pages say otherwise, they are right: say so in a report on the onboarding task, with what the page showed.

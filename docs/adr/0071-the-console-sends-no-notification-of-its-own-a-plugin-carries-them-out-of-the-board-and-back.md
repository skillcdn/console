# ADR-0071: The console sends no notification of its own; a plugin carries them out of the board and back

- Status: Accepted
- Date: 2026-11-08
- Closes open question 2 of [architecture.md](../architecture.md), under which notifications were a port of the console's with adapters to come. Follows [ADR-0049](0049-a-plugin-is-an-npm-package-installed-into-the-image-and-enabled-by-an-administrator.md), under which a feature of an organization's work is a plugin, and [console-plugins ADR-0008](https://github.com/skillcdn/console-plugins/blob/main/docs/adr/0008-every-notification-leaves-the-console-through-the-messenger-plugin-which-reads-what-it-tells-as-a-principal.md), where the plugins' side of this was decided first.

## Context

The board tells a person what waits for them when they look at it. What reaches them when they do not, a decision raised for them, an approval answered, a task handed to them, was left open: notifications were to be a port, with the adapters chosen when a milestone needed them, and a plugin was to write a person a line on the board (`ctx.console.notes`) in the meantime.

The first plugins settled the shape from their side. The organization's people live in a messenger; the `hr` plugin's approvals must reach the approver there and be answered there, and every other plugin will ask the same. Two consoles sending mail and a messenger plugin sending messages would reach the same person twice, by different rules. And what a notification needs, the words in the person's language, the thread it belongs to, the button that answers, is the messenger's to know, not the console's.

## Decision

The console sends no notification of its own. Carrying what happens on the board to a person away from it, and bringing their answer back, is a plugin's work: the `messenger` plugin in `skillcdn/console-plugins`, one adapter per messenger, a messenger at a time. A plugin that produces something to tell, `hr` or any other, emits its own events and tells nobody; the carrier listens and speaks.

What the console provides is what a carrier needs and nothing a carrier does:

- the events, the board's and the plugins' own, delivered to hooks in order ([ADR-0052](0052-a-plugins-board-is-a-project-made-or-chosen-when-it-is-enabled-and-what-it-puts-there-carries-its-name.md)), and a decision that reaches whom it is for wherever they are ([ADR-0068](0068-a-decision-reaches-whom-it-is-addressed-to-wherever-it-is-and-a-plugins-reaches-the-managers-above-them.md));
- the work email that matches a person to their account elsewhere ([ADR-0069](0069-the-directory-keeps-a-work-email-read-by-an-administrator-the-person-and-a-plugin-allowed-to.md));
- the secrets a messenger's API takes, sealed and put in by the console ([ADR-0070](0070-a-secret-is-sealed-by-the-console-from-an-answer-and-goes-where-its-setting-says.md)), and the console's own address and the plugin's endpoints, for a link back and a callback;
- the standing to act as the carrier must: to read another plugin's detail under a role granted to it, and to run a command or answer a decision for the person who pressed a button elsewhere, within what that person may do, which is the next decision.

A note on the board for a person (`ctx.console.notes`) is not built. An organization without a messenger reads the board; a carrier inside the console, a list of what waits for me fed by the same events, is a later adapter of the same plugin, should one be asked for.

## Consequences

- The console keeps no mail, no push, no templates, no per-person preferences for channels, and no port for them; a deployment's environment names no mail service.
- Everything a carrier needs is a capability a plugin asks for in a sentence an administrator consents to, so that who tells what to whom is visible on the settings page as every other plugin's reach is.
- The language a person is spoken to in is the console's record of their language, read by the carrier with the person.
- Two carriers, a plugin per messenger, may run side by side; each sees every event and decides what it carries.

---
"@skillcdn/console": patch
---

The `slack` wake source carries what a message shows. It read the `text` of a message, which beside a message's blocks is what a notification says in their place and leaves a table out, so a wake for a message with a table arrived without it, and said nothing of what was missing. A wake now reads the blocks where a message has them: a table arrives as rows between bars, a list, code and a quote as the messenger writes them in a message's text, and the words of an app's blocks with them. What a wake does not carry of a message, a picture or a button, is marked where it stood: `[image, not carried in this wake]`.

A message longer than 4,000 characters is cut as before, and the wake's first line now says so, with how long the whole is and the moment of the message to read with the messenger's own tool. What wakes an agent is unchanged, and a message without blocks reads as it did.

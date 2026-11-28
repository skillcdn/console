---
"@skillcdn/console": patch
---

An agent account is told how to keep the keys it makes, and how to take a secret from a page in the browser it runs in.

- **A key an agent account makes, it makes to last.** The desk's template, under Secrets, and the agent's part of the skill `running-an-agent` say to make a token with no more reach than the work asks for and without an end where the service lets one choose, since the machine and its OS account are the agent's alone and nobody is there to renew one; where an end is set, the day is kept with the value (`--expires`) and the agent makes the next one itself. The wake the console sends a month before a secret's day says the same, so an account set up before reads it when its next key is due. A desk that is there keeps its sentences until its account writes the new ones in.
- **A secret a page shows is taken by the browser.** In `headless`, the agent's browser where none is named, the browser's clipboard is its own and not the system's (seen on Windows), so the line the skill gave, `pbpaste | console secret <name> --set`, set nothing or what was copied before. The skill now says to have the script tool write the value to a file and to set it from there, and keeps the clipboard for `window` and `chrome`; and that no screenshot and no snapshot is taken while a secret stands on a page.

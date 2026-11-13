---
"@skillcdn/console": patch
---

The line `console agent setup` prints for starting the runner by hand runs on Windows as it is pasted: its two commands are joined by `;` there, as the PowerShell every Windows has joins them, where `&&` was refused before PowerShell 7.

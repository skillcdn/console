---
"@skillcdn/console": patch
---

`console serve` passes on the referrer's origin when the page is on this machine (ADR-0083), as `Referer: <origin>/`, so that a plugin's widgets and pages show in a console a person serves from their machine, or in a development server in front of the command: the console reads that origin to know which page may embed a frame, and without it answered every frame with a 404. The path, query and fragment never travel, nor a referrer from anywhere else; cookies and `Origin` are stripped as before.

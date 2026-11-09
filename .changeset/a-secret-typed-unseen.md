---
"@skillcdn/console": patch
---

`console plugin <key> secret <name>`, `console login --token-stdin` and the `pack-token --stdin` commands ask for the value at the terminal and take it typed unseen, where a value typed there was echoed on the screen before; piped in or redirected from a file, standard input is read as before. The help, the specs and the skill `planning-the-board` say never to give a secret on the command line, through `echo` or through an agent. The Korean pages say a token is kept encrypted, where they said sealed.

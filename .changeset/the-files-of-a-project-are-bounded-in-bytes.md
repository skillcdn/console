---
"@skillcdn/console": patch
---

The files of one project may be bounded in bytes together, where the deployment says so: `PROJECT_FILE_BYTES_AT_MOST` counts the files runs hand in, those put in comments and those attached to pages, each by its size, and a file that would take the project over it is refused as `project.too_many_bytes` (`409`) before any byte is kept. No bound unless set. The command's help names the refusal on `hand-in`, `comment` and `attach`, and says what to do: hand in a link instead.

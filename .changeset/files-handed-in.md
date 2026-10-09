---
"@skillcdn/console": minor
---

Files handed in. An artifact is a link or a file: `restArtifactSchema` carries `kind`, `url` (for a link, else `null`) and `file` (for a file, else `null`: its `name`, `size`, `contentType` and `sha256`), with `ARTIFACT_KINDS`, `restFileSchema`, `restFileInputSchema`, and the limits `MAX_FILE_BYTES` and `MAX_FILE_NAME_LENGTH`. The client gains `handInFile(runId, { name, bytes, contentType, label })`, which sends the file as a form to `POST /api/v1/runs/<id>/files`, and `fileUrl(artifactId)`, where its bytes are read back (`REST_ROUTES.files`, `restPath("files", id)`). `console hand-in` takes the path of a file as well as an https link, and `CliIo` takes `readBytes`. `RunCard` and `RunList` show a file by its name and size, read from the console, and take `fileHref` for a console served from another origin than its API; `formatBytes` is exported with the other small blocks.

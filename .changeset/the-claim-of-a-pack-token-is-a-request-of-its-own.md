---
"@skillcdn/console": patch
---

Breaking: the console claims a pack token at the deployment on `POST .../pack-token/connect/claim`, for a project's token and for the workspace's, and `GET .../pack-token/connect` reads how the connection stands and changes nothing, where before the read itself claimed the token and kept it, so that a link followed from anywhere, carrying the session, did so outside the page (ADR-0046). `console project pack-token --connect` and `console workspace pack-token --connect` ask the claim at the interval the deployment named, and so do the settings pages; `PackConnect` and `PackTokenWays` take `claim` beside `poll`, and the client has `claimPackTokenConnection` and `claimWorkspacePackTokenConnection`. The floors move to 0.4.1 on both sides (ADR-0038): this command needs a console from 0.4.1, whose `--connect` it would otherwise wait on for a claim nobody makes, and a console from 0.4.1 takes commands from 0.4.1 for the same reason.

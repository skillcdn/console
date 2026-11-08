---
"@skillcdn/console": patch
---

A collection may forget: `defineCollection(name, { ..., retention: { days, by? } })` keeps a record `days` (1 to `MAX_PLUGIN_RETENTION_DAYS`, 3650) after the moment `by` names, `createdAt` unless said, `updatedAt`, or an indexed field holding a day or an instant as ISO 8601 text; every hour the worker removes what is past it, archived or not, with its versions, links and files, so that a collection of deliveries or log lines never reaches the plugin's quota, which counts a record while it is kept. With `history: false` it is a light collection for logs. `CollectionDefinition` and `CollectionDescription` carry `retention` (`null` for as long as the plugin is), `GET /api/v1/plugins/<key>` answers `keeps`, the collections forgotten after a while with their days (read as optional), and the plugin's settings page says what it keeps and for how long.

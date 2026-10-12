---
"@skillcdn/console": patch
---

The organization at the git host says who is in (ADR-0022).

- **The REST API.** `GET /api/v1/people` answers `organization` beside `items` and `listed`: the organization at the git host whose members are in, where the deployment names one (`host`, `name`, `syncedAt`, when the worker last read it whole, or `null` until it has), or `null`. A person the organization let in carries `source: "organization"`, and `PATCH /api/v1/people/<id>` refuses to change their standing (`person.of_organization`).
- **The client.** `restOrganizationSchema` and `RestOrganization`.
- **The default UI.** The People page says which organization decides who is in and when it was last read; `PeopleList` takes `organization`; `useConsoleData` answers `organization`. Words under `people`: `organization`, `organizationRead`, `organizationNotRead`.
- **The deployment.** `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_ORG` name the GitHub App installed on the organization and the organization: asked at sign-in, and read whole by the worker every ten minutes, so that those who left are out and those who returned are in, by the account's id.

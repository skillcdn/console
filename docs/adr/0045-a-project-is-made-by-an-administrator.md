# ADR-0045: A project is made by an administrator

- Status: Accepted
- Date: 2026-10-30
- Refines point 3 of [ADR-0008](0008-a-workspace-holds-projects-and-what-a-person-may-see-and-change-is-decided-per-project.md), which stands otherwise; a token makes one as its person does ([ADR-0021](0021-a-token-configures-as-its-person-does.md)).

## Context

Since ADR-0008 any member of the workspace made a project, and became its owner. On a console of one organization that was never a question. On a console where outside builders and customers' projects live side by side, it is: a member who may not see a private project learns that it exists by asking for its key, since the key, often a customer's name, is refused as taken (`project.key_taken`); and the projects of a workspace are an administrator's to shape in the first place, as its categories and its people are.

## Decision

1. **A project is made by an administrator**, on the console's own pages or through their agent with their token, and they become its owner. `POST /api/v1/projects` refuses a member with `auth.forbidden`, as the categories do; the pages show the form and the way to it to an administrator alone, and the command passes the refusal on with its hint.
2. **An owner is listed as before**: an administrator who makes a project for someone lists them as its owner, and may take themselves off it; the project is theirs then, and the administrators own it by office as they own every project.
3. **A key refused as taken is an administrator's to see**, who sees every project; nobody else is told whether a key is in use.

## Consequences

- A member asks an administrator for a project, or an owner for a place in theirs; the empty page says so.
- The tests of the board make their projects through the database as an administrator's request would, so that the people of a test keep the roles the test is about.
- Rejected: keys chosen by the server (a key is what paths and the command say, and people choose them); a project made by anyone but seen only by its owner until an administrator admits it (two states where one will do); refusing the key as taken to a member while making the project for an administrator anyway (the key is the leak).

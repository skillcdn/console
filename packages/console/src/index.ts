// What a custom console is built from (docs/architecture.md, "The package and custom consoles"):
// the schemas and the client of the console's API, the components, and the composition of the
// default console. The first layer is here; `@skillcdn/console/api` is the same layer on its
// own, for a server or a script that wants none of the pages. The other layers arrive with the
// milestones of docs/roadmap.md.

export * from "./api.js";

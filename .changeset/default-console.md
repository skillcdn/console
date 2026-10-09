---
"@skillcdn/console": minor
---

The second and third layers of the package: the components of the board (`Board`, `TaskView`, `TaskForm`, `DecisionList`, `DecisionForm`, `EventFeed`, `Shell`, `SignIn`, `Markdown` and the small blocks), each taking its data as props and nothing from the network, and `createConsole(config)`, the default console assembled from them, with the places a team may replace named in `ConsoleComponents`. The styles ship as `@skillcdn/console/console.css`. React 19 is a peer dependency.

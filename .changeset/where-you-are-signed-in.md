---
"@skillcdn/console": patch
---

A person sees the browsers they are signed in on, under Settings, in a view of their own beside the workspace's (`/settings/sessions`): each as a browser on a platform, when it was last used, where it last came from and the day it signed in, the current one marked; and signs any other out, or all the others at once. `GET /api/v1/sessions`, `DELETE /api/v1/sessions/<id>` and `DELETE /api/v1/sessions/others`, for a person on the console's own pages and never for a token; `SessionList` is a component of the package, the client has `sessions`, `endSession` and `endOtherSessions`, and the composition's actions read the sessions when the view opens. A session whose time ended is not found when it is signed out, as one ended already is, and the view reads the sessions again whether a sign-out went or not. A session begun before this names no browser.

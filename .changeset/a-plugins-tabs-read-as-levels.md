---
"@skillcdn/console": patch
---

A plugin's tabs read as levels of one thing. Its pages go on from the header's tabs on the same gutters (`sc-page-tabs`), `sc-subtabs` around `sc-tab`s is now the console's view switch for the views within a page, and a page's frame stands one step (`--sc-space-4`) outside the page's column, so that a page that pads itself by that step, as the template does, lines up with the tabs above it. A plugin's page that pads itself by more, or by nothing, shows the difference.

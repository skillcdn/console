---
"@skillcdn/console": patch
---

A plugin's frame opens a tab only for a press in it (ADR-0078): a press on the console's own page or in another plugin's frame let a frame that kept asking open one, since the browser keeps a press for the whole page. One press opens one tab: the page takes the focus back from the frame as it opens it, and another tab takes another press in the frame.

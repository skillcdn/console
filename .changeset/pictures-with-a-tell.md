---
"@skillcdn/console": patch
---

A supervisor sends pictures with a `tell` or an `interrupt` (ADR-0086): `ConsoleClient.sendSignal(handle, input, pictures)` sends them as the parts of a form, up to `MAX_SIGNAL_ATTACHMENTS`, and the signal's `attachments` name them. The runner reads them (`readSignalFile`) and hands them to the product as image blocks, and they are kept with what the agent was sent in the session's transcript; a supervisor's page shows them at `signalFileUrl`. A picture is one by its bytes, whatever it was called, for a signal as for a session's transcript, where one said to be a kind it is not is refused.

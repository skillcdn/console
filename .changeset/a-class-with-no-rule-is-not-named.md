---
"@skillcdn/console": patch
---

Breaking: a class the stylesheet has no rule for is no longer on the elements, and a rule nothing named is gone. Off the elements: `sc-agent-accounts`, `sc-agent-card`, `sc-agent-elsewhere`, `sc-agent-form`, `sc-agent-secrets`, `sc-approval`, `sc-connect-code`, `sc-decision-header`, `sc-fieldset`, `sc-member-lookup`, `sc-pack-token-form`, `sc-paged-more`, `sc-people-organization`, `sc-people-page`, `sc-plugin-frame-box-widget`, `sc-plugin-holder`, `sc-plugin-holders`, `sc-rules`, `sc-service-fields`, `sc-sessions`, `sc-settings-words`, `sc-sign-in-button-label`, `sc-talk-working-what` and `sc-workers-field`. Out of the stylesheet: `sc-decision-people`, `sc-decision-row-answer`, `sc-plugin-grant-input`, `sc-project` and `sc-report-list`. A stylesheet of a console of your own that named one of them names nothing now; the parts it can name are listed in `src/styles/README.md`.

# TODO Ralph Loop Board

Generated from `TODO.md` unchecked items for deterministic subagent orchestration.

## Ralph Loop Defaults

- mode: one primary TODO item per iteration
- maxParallelSubtasks: 3 (`analyze`, up to two `implement-*`, single `validate`)
- maxIterationsPerItem: 4
- integration: merge only one completed item branch into `main` at a time
- verification gate after each merge: `yarn harness:verify`
- TODO checkoff gate: only after merged + verified on `main`

## Safe Integration Sequence

```powershell
git checkout main
git pull --rebase origin main
git fetch origin
git merge --no-ff origin/<agent-branch>
yarn harness:verify
git push origin main
```

## Queue (Conflict-Aware Ordering)

| Item      | Line | Risk   | Area                      | Proposed branch                                            | TODO text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | ---: | ------ | ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TODO-L046 |   46 | medium | external-integrations     | `agent/TODO-L046-discord-bot-notify-on-new-feedback-submi` | Discord Bot — notify on new feedback; submit feedback via `/feedback` slash command                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| TODO-L048 |   48 | medium | external-integrations     | `agent/TODO-L048-integrations-with-form-providers-tally-j` | Integrations with form providers (Tally, Jotform, Google Forms, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| TODO-L051 |   51 | medium | external-integrations     | `agent/TODO-L051-export-feedback-to-google-sheets-excel-a` | Export feedback to Google Sheets / Excel / Airtable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| TODO-L053 |   53 | medium | external-integrations     | `agent/TODO-L053-sync-roadmaps-to-github-projects`         | Sync roadmaps to GitHub Projects                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TODO-L102 |  102 | medium | org-settings-storage      | `agent/TODO-L102-add-organization-avatar-image-to-the-org` | Add Organization avatar image to the organization settings, with file upload using the S3 bucket                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TODO-L041 |   41 | medium | public-feedback-core      | `agent/TODO-L041-create-embeddable-widgets-for-customers`  | Create embeddable widgets for customers to add to their own website                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| TODO-L047 |   47 | medium | public-feedback-core      | `agent/TODO-L047-polls-feature-suggestions-with-yay-or-na` | Polls / feature suggestions with yay-or-nay vote                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| TODO-L049 |   49 | medium | public-feedback-core      | `agent/TODO-L049-simple-form-website-for-collecting-feedb` | Simple form website for collecting feedback publicly and adding it to the board without a public board (for internal use or private feedback collection)                                                                                                                                                                                                                                                                                                                                                                                                   |
| TODO-L054 |   54 | medium | public-feedback-core      | `agent/TODO-L054-customizable-vote-style-thumbs-arrows-du` | Customizable vote style (thumbs, arrows, ducks, rockets, etc.)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| TODO-L056 |   56 | medium | public-feedback-core      | `agent/TODO-L056-add-a-feedback-tab-to-the-product-settin` | Add a "Feedback" tab to the product settings page that shows a list of all feedback items with filters (status, tags, etc.) and search                                                                                                                                                                                                                                                                                                                                                                                                                     |
| TODO-L050 |   50 | medium | roadmaps                  | `agent/TODO-L050-for-the-new-product-form-add-options-bet` | For the new product form, add options between what type of product to create, like public feedback board, private feedback collection form, or in the future roadmaps/etc.. Make it a multi-step guide that explains the different options and helps users choose the right one for their needs. Different features can be combined based on the product type (e.g. a public feedback board would have voting and commenting enabled, while a private feedback form would just collect submissions from a third party form without showing them publicly). |
| TODO-L141 |  141 | high   | deployment-selfhost       | `agent/TODO-L141-detect-between-self-hosted-and-cloud-bas` | Detect between self hosted and cloud based on env variables. if locally hosted, replace the billing tab with a "Status" tab that shows the status of different services (database, storage, etc.) and any errors or warnings related to them. This will help self-hosted users monitor the health of their instance and troubleshoot any issues that arise.                                                                                                                                                                                                |
| TODO-L005 |    5 | high   | framework-platform        | `agent/TODO-L005-add-language-selection-using-i18n`        | Add language selection using i18n                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| TODO-L042 |   42 | high   | framework-platform        | `agent/TODO-L042-migrate-to-nuxt-4`                        | Migrate to Nuxt 4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| TODO-L040 |   40 | high   | notifications             | `agent/TODO-L040-notifications-infrastructure-real-time-o` | Notifications infrastructure (real-time or polling for in-app notifications)                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| TODO-L023 |   23 | high   | public-feedback-core      | `agent/TODO-L023-file-image-log-attachments-add-file-uplo` | **File/image/log attachments** — Add file upload support to the feedback submission form; store files (S3/local) and reference them from the feedback record                                                                                                                                                                                                                                                                                                                                                                                               |
| TODO-L024 |   24 | high   | public-feedback-core      | `agent/TODO-L024-email-notification-subscription-allow-us` | **Email notification subscription** — Allow users/anonymous submitters to subscribe to a feedback item for state-change and comment notifications; implement notification dispatch on status change and new public comment                                                                                                                                                                                                                                                                                                                                 |
| TODO-L057 |   57 | high   | public-feedback-core      | `agent/TODO-L057-allow-product-admins-to-add-and-change-s` | Allow product admins to add and change status tags (e.g. "planned", "in progress", "completed")                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TODO-L076 |   76 | high   | public-feedback-core      | `agent/TODO-L076-when-on-a-public-board-on-a-custom-domai` | When on a public board on a custom domain or subdomain but I am logged in to the dashboard on the main domain, it should show that I am logged in and allow me to access the dashboard from the public board. Currently, it shows that I am not logged in and when I click the login button, it takes me to the main domain login page instead of showing a login modal on the public board. We should either show a login modal on the public board or redirect to the main domain login page and then back to the public board after login.              |
| TODO-L089 |   89 | high   | public-feedback-core      | `agent/TODO-L089-add-ability-on-public-feedback-items-to`  | Add ability on public feedback items to subscribe to a feedback to get notified when there are updates. For anonymous this should open a prompt for email, and for logged in users this should open a modal where they can select between email and app notifications. If app notifications has not been enabled, it should prompt for access before toggling the button.                                                                                                                                                                                  |
| TODO-L119 |  119 | high   | public-feedback-core      | `agent/TODO-L119-for-the-feedbacks-add-ability-to-downvot` | For the feedbacks, add ability to downvote feedback in addition to upvote, and show the total votes (upvotes - downvotes) on the feedback card. This will allow users to express disagreement with feedback and help surface the most popular feedback more accurately.                                                                                                                                                                                                                                                                                    |
| TODO-L121 |  121 | high   | public-feedback-core      | `agent/TODO-L121-for-the-public-feedback-board-add-a-filt` | For the public feedback board, add a filter option to filter feedback by category, status, or tags. This will allow users to easily find feedback that is relevant to them and help them navigate the board more effectively.                                                                                                                                                                                                                                                                                                                              |
| TODO-L034 |   34 | high   | quality-infra             | `agent/TODO-L034-set-up-full-test-infrastructure`          | Set up full test infrastructure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| TODO-L052 |   52 | high   | roadmaps                  | `agent/TODO-L052-roadmap-page-public-timeline-view-based`  | Roadmap page — public timeline view based on feedback status tags                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| TODO-L043 |   43 | high   | security-abuse-prevention | `agent/TODO-L043-anti-spam-ip-based-rate-limiting-duplica` | Anti-spam: IP-based rate limiting, duplicate content detection, user reputation scoring, CAPTCHA (optional)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| TODO-L044 |   44 | high   | security-abuse-prevention | `agent/TODO-L044-review-and-harden-html-sanitization-for`  | Review and harden HTML sanitization for user-submitted content; audit for SQL injection risks                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Subagent Decomposition Packets

For each item, dispatch these subtasks with controlled parallelism and one validation owner:

### TODO-L046 - Discord Bot — notify on new feedback; submit feedback via `/feedback` slash command

- branch: `agent/TODO-L046-discord-bot-notify-on-new-feedback-submi`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L048 - Integrations with form providers (Tally, Jotform, Google Forms, etc.)

- branch: `agent/TODO-L048-integrations-with-form-providers-tally-j`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L051 - Export feedback to Google Sheets / Excel / Airtable

- branch: `agent/TODO-L051-export-feedback-to-google-sheets-excel-a`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L053 - Sync roadmaps to GitHub Projects

- branch: `agent/TODO-L053-sync-roadmaps-to-github-projects`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L102 - Add Organization avatar image to the organization settings, with file upload using the S3 bucket

- branch: `agent/TODO-L102-add-organization-avatar-image-to-the-org`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L041 - Create embeddable widgets for customers to add to their own website

- branch: `agent/TODO-L041-create-embeddable-widgets-for-customers`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L047 - Polls / feature suggestions with yay-or-nay vote

- branch: `agent/TODO-L047-polls-feature-suggestions-with-yay-or-na`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L049 - Simple form website for collecting feedback publicly and adding it to the board without a public board (for internal use or private feedback collection)

- branch: `agent/TODO-L049-simple-form-website-for-collecting-feedb`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L054 - Customizable vote style (thumbs, arrows, ducks, rockets, etc.)

- branch: `agent/TODO-L054-customizable-vote-style-thumbs-arrows-du`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L056 - Add a "Feedback" tab to the product settings page that shows a list of all feedback items with filters (status, tags, etc.) and search

- branch: `agent/TODO-L056-add-a-feedback-tab-to-the-product-settin`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L050 - For the new product form, add options between what type of product to create, like public feedback board, private feedback collection form, or in the future roadmaps/etc.. Make it a multi-step guide that explains the different options and helps users choose the right one for their needs. Different features can be combined based on the product type (e.g. a public feedback board would have voting and commenting enabled, while a private feedback form would just collect submissions from a third party form without showing them publicly).

- branch: `agent/TODO-L050-for-the-new-product-form-add-options-bet`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L141 - Detect between self hosted and cloud based on env variables. if locally hosted, replace the billing tab with a "Status" tab that shows the status of different services (database, storage, etc.) and any errors or warnings related to them. This will help self-hosted users monitor the health of their instance and troubleshoot any issues that arise.

- branch: `agent/TODO-L141-detect-between-self-hosted-and-cloud-bas`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L005 - Add language selection using i18n

- branch: `agent/TODO-L005-add-language-selection-using-i18n`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L042 - Migrate to Nuxt 4

- branch: `agent/TODO-L042-migrate-to-nuxt-4`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L040 - Notifications infrastructure (real-time or polling for in-app notifications)

- branch: `agent/TODO-L040-notifications-infrastructure-real-time-o`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L023 - **File/image/log attachments** — Add file upload support to the feedback submission form; store files (S3/local) and reference them from the feedback record

- branch: `agent/TODO-L023-file-image-log-attachments-add-file-uplo`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L024 - **Email notification subscription** — Allow users/anonymous submitters to subscribe to a feedback item for state-change and comment notifications; implement notification dispatch on status change and new public comment

- branch: `agent/TODO-L024-email-notification-subscription-allow-us`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L057 - Allow product admins to add and change status tags (e.g. "planned", "in progress", "completed")

- branch: `agent/TODO-L057-allow-product-admins-to-add-and-change-s`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L076 - When on a public board on a custom domain or subdomain but I am logged in to the dashboard on the main domain, it should show that I am logged in and allow me to access the dashboard from the public board. Currently, it shows that I am not logged in and when I click the login button, it takes me to the main domain login page instead of showing a login modal on the public board. We should either show a login modal on the public board or redirect to the main domain login page and then back to the public board after login.

- branch: `agent/TODO-L076-when-on-a-public-board-on-a-custom-domai`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L089 - Add ability on public feedback items to subscribe to a feedback to get notified when there are updates. For anonymous this should open a prompt for email, and for logged in users this should open a modal where they can select between email and app notifications. If app notifications has not been enabled, it should prompt for access before toggling the button.

- branch: `agent/TODO-L089-add-ability-on-public-feedback-items-to`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L119 - For the feedbacks, add ability to downvote feedback in addition to upvote, and show the total votes (upvotes - downvotes) on the feedback card. This will allow users to express disagreement with feedback and help surface the most popular feedback more accurately.

- branch: `agent/TODO-L119-for-the-feedbacks-add-ability-to-downvot`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L121 - For the public feedback board, add a filter option to filter feedback by category, status, or tags. This will allow users to easily find feedback that is relevant to them and help them navigate the board more effectively.

- branch: `agent/TODO-L121-for-the-public-feedback-board-add-a-filt`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L034 - Set up full test infrastructure

- branch: `agent/TODO-L034-set-up-full-test-infrastructure`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L052 - Roadmap page — public timeline view based on feedback status tags

- branch: `agent/TODO-L052-roadmap-page-public-timeline-view-based`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L043 - Anti-spam: IP-based rate limiting, duplicate content detection, user reputation scoring, CAPTCHA (optional)

- branch: `agent/TODO-L043-anti-spam-ip-based-rate-limiting-duplica`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

### TODO-L044 - Review and harden HTML sanitization for user-submitted content; audit for SQL injection risks

- branch: `agent/TODO-L044-review-and-harden-html-sanitization-for`
- subtasks:
  - analyze: inspect existing code paths and define explicit acceptance checks
  - implement-api-data: apply focused server/schema/data changes where needed
  - implement-ui-flow: apply focused UI/UX changes and keep selectors stable for tests
  - validate: run `yarn typecheck`, `yarn test`, `yarn lint`, `yarn test:e2e:if-available` and report exact outputs
  - document: update tests/docs and record assumptions, caveats, blockers

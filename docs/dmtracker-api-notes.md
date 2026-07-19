# DMTracker API Notes

Captured from:

- 2026-06-26: DMTracker web app network panel
- 2026-06-26: existing n8n workflow configuration
- 2026-07-19: DMTracker in-app browser inspection and current front-end bundle

This is a working reverse-engineering note, not an official spec.

## Overview

DMTracker appears to use two backend layers:

- `https://app.dmtracker.ai/api/v1/...` for product-specific business endpoints
- `https://ybaaqyyghgafjlgpiwbk.supabase.co/...` for auth, tables, and RPC functions

## Auth

Observed auth pattern:

- `Authorization: Bearer <JWT>`
- `Content-Type: application/json`

Important:

- Do not store raw bearer tokens in this file.
- The n8n workflow currently references a bearer credential named `DMTracker.ai`.

## Known Organizations

Observed organization ids:

```text
bb75f257-d450-41f5-ab98-e60b1efd4fcf
4a31fbee-f5a0-42d0-9f5f-10ed4ca50786
```

The July 2026 investigation used:

```text
4a31fbee-f5a0-42d0-9f5f-10ed4ca50786
```

## Core Endpoints

### 1. Get pipeline contacts

```http
POST https://app.dmtracker.ai/api/v1/pipeline/get-pipeline-contacts
```

Observed payload:

```json
{
  "organization_id": "bb75f257-d450-41f5-ab98-e60b1efd4fcf",
  "search_text": "",
  "lead_status_filter": "all",
  "conversation_status_filter": "all",
  "source_filter": "all",
  "page_number": 1,
  "limit_size": 50,
  "per_stage_limit": 10,
  "sort_field": "last_message_at",
  "sort_direction": "DESC",
  "specific_stage_id": null,
  "tag_filter_type": "any_of",
  "tag_ids": null,
  "assignee_filter_type": null,
  "assignee_user_ids": null,
  "outreach_reason_filter": null
}
```

Observed response shape:

```json
{
  "status": "success",
  "data": {
    "columns": [
      {
        "stage_id": "uuid",
        "stage_name": "Outreach Sent",
        "stage_color": "#FF6A00",
        "stage_position": 1,
        "contacts": [
          {
            "id": "uuid",
            "username": "automationislife",
            "last_message_at": "2026-06-26T12:44:36.319+00:00",
            "last_message_content": "Ready 5",
            "lead_status_id": 1,
            "follow_up_needed": true,
            "current_followup_stage": null,
            "had_outreach": true,
            "first_response_at": "2026-06-26T12:43:59.555+00:00",
            "last_response_at": "2026-06-26T12:44:36.319+00:00",
            "created_at": "2026-06-26T12:43:59.555+00:00",
            "tags": [],
            "notes_count": 0,
            "pipeline_stage_id": "uuid"
          }
        ],
        "total_count": 1,
        "has_more": false
      }
    ],
    "unassigned": []
  }
}
```

Useful fields for automation:

- `username`
- `id`
- `follow_up_needed`
- `current_followup_stage`
- `had_outreach`
- `last_message_at`
- `last_message_content`
- `pipeline_stage_id`

July 2026 pipeline page payload reconstructed from the current front-end bundle:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "search_text": "",
  "lead_status_filter": "all",
  "source_filter": "all",
  "conversation_status_filter": "all",
  "tag_ids": null,
  "tag_filter_type": null,
  "outreach_reason_filter": null,
  "assignee_user_ids": null,
  "assignee_filter_type": null,
  "sort_field": "last_message_at",
  "sort_direction": "DESC",
  "limit_size": 50,
  "per_stage_limit": 10,
  "page_number": 1,
  "specific_stage_id": null
}
```

Notes from the July 2026 pass:

- This payload was reconstructed from the public client bundle and visible page defaults, not from a raw HAR export.
- The in-app browser did not expose the raw network request log during this pass.
- The request is sent with `Authorization: Bearer <JWT>` and `Content-Type: application/json`.
- The visible default pipeline stage was `Outreach Sent`.
- `specific_stage_id` is `null` for the full board load, then a concrete stage id, or `"unassigned"`, for stage-specific fetches.

Pipeline filters used by the front end:

```json
{
  "search_text": "string",
  "lead_status_filter": "all | lead-status-id",
  "source_filter": "all | source-value",
  "conversation_status_filter": "all | conversation-status-value",
  "tag_ids": "array | null",
  "tag_filter_type": "any_of | all_of | null",
  "outreach_reason_filter": "null | 0 | outreach-reason-id",
  "assignee_user_ids": "array | null",
  "assignee_filter_type": "any_of | all_of | null",
  "sort_field": "last_message_at | created_at",
  "sort_direction": "ASC | DESC",
  "limit_size": "number",
  "per_stage_limit": "number",
  "page_number": "number",
  "specific_stage_id": "pipeline-stage-id | unassigned | null"
}
```

### 1.1. Update contact pipeline stage

```http
POST https://app.dmtracker.ai/api/v1/contact/update-pipeline-stage
```

Payload reconstructed from the current front-end bundle:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "contact_id": "contact-uuid",
  "pipeline_stage_id": "pipeline-stage-uuid"
}
```

Usage:

- Called when a contact card is moved to another pipeline stage.
- Requires the same bearer auth pattern as the pipeline read endpoint.

### 1.2. Get organization pipeline stages

```http
POST https://app.dmtracker.ai/api/v1/organization/get-pipeline-stages
```

Payload reconstructed from the current front-end bundle:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786"
}
```

Related stage-management endpoints seen in the current front-end bundle:

```text
POST /api/v1/organization/update-pipeline-stage
POST /api/v1/organization/create-pipeline-stage
POST /api/v1/organization/delete-pipeline-stage
POST /api/v1/organization/reorder-pipeline-stages
```

### 2. Get follow-up board status

```http
POST https://app.dmtracker.ai/api/v1/stages/get-paginated-markdone-followups-v2
```

Observed payload from n8n node:

```json
{
  "org_id": "bb75f257-d450-41f5-ab98-e60b1efd4fcf",
  "limit_size": 20,
  "page_number": 1,
  "sort_field": "contact_last_response_at",
  "specific_stage_id": null,
  "search_text": "",
  "sort_direction": "ASC",
  "tag_ids": null,
  "tag_filter_type": "any_of",
  "source_filter": "all",
  "conversation_status_filter": "all",
  "pipeline_stage_filter": null,
  "lead_status_filter": "all",
  "outreach_reason_filter": null,
  "assignee_user_ids": null,
  "assignee_filter_type": "any_of",
  "board_id": null
}
```

Observed response shape from n8n output:

```json
[
  {
    "status": "success",
    "data": [
      {
        "stage_data": {
          "stage_id": "868600bc-5711-43f0-83aa-631774a9c97e",
          "stage_index": 1,
          "stage_name": null,
          "time_after": 1,
          "is_last_stage": false,
          "contacts": [],
          "total_count": 0,
          "has_more": false
        }
      },
      {
        "stage_data": {
          "stage_id": "60f1784f-a8f9-4f48-9c9a-f261220d0801",
          "stage_index": 2,
          "stage_name": "",
          "time_after": 3,
          "is_last_stage": false,
          "contacts": [],
          "total_count": 0,
          "has_more": false
        }
      }
    ]
  }
]
```

Interpretation:

- Follow-up logic is stage-based.
- `time_after` looks like the delay before the stage becomes due.
- Empty `contacts` means no lead is currently due at that stage.
- The app UI showed stages from 1st to 9th follow-up.

### 3. Get contact details

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_contact_details
```

Observed payload from n8n node:

```json
{
  "p_contact_id": "47f54f7e-8066-4cf2-9949-9b88f5ba07a7",
  "p_organization_id": "bb75f257-d450-41f5-ab98-e60b1efd4fcf"
}
```

Notes:

- This is a Supabase RPC, not a DMTracker `app.dmtracker.ai` endpoint.
- Response was not captured in this pass.
- It is likely the best candidate to resolve one pipeline/follow-up contact into a richer contact record.

## Supporting Endpoints Seen In Network

These were observed during page load or refresh:

### DMTracker app endpoints

```text
POST   /api/v1/sessions/register
POST   /api/v1/sessions/validate
GET    /api/v1/organization/list-members?organization_id=...
GET    /api/v1/organization/get-tags?organization_id=...
POST   /api/v1/organization/follow-up-settings
POST   /api/v1/follow-up-boards/restamp
POST   /api/v1/organization/get-pipeline-stages
POST   /api/v1/organization/update-pipeline-stage
POST   /api/v1/organization/create-pipeline-stage
POST   /api/v1/organization/delete-pipeline-stage
POST   /api/v1/organization/reorder-pipeline-stages
POST   /api/v1/contact/update-pipeline-stage
POST   /api/v1/contact/update-lead-status
POST   /api/v1/contact/update-assignee
POST   /api/v1/contact/update-outreach
POST   /api/v1/contact/bulk-update
GET    /api/v1/contact/get-contact-tags?organization_id=...&contact_id=...
POST   /api/v1/stages/get-paginated-contacts-v2
POST   /api/v1/stages/get-paginated-completed-followups
POST   /api/v1/stages/get-paginated-markdone-followups-v2
POST   /api/v1/stages/get-paginated-snoozed-contacts
GET    /api/v1/contact/get-notes-paginated?organization_id=...&contact_id=...&limit=...&offset=...
```

### Supabase endpoints

```text
GET    /auth/v1/user
POST   /auth/v1/token?grant_type=refresh_token
GET    /rest/v1/organizations?...
GET    /rest/v1/organization_settings?...
GET    /rest/v1/organization_billing?...
GET    /rest/v1/user_organizations?...
GET    /rest/v1/agencies?...
GET    /rest/v1/agency_organizations?...
GET    /rest/v1/follow_up_boards?...
GET    /rest/v1/pipeline_stages?...
GET    /rest/v1/organization_outreach?...
GET    /rest/v1/stages?...
POST   /rest/v1/stages
PATCH  /rest/v1/stages?id=eq...
GET    /rest/v1/follow_up_boards?...
POST   /rest/v1/follow_up_boards
PATCH  /rest/v1/follow_up_boards?id=eq...
POST   /rest/v1/rpc/get_organization_users
POST   /rest/v1/rpc/get_contact_details
POST   /rest/v1/rpc/list_contacts_light_v3
POST   /rest/v1/rpc/count_contacts_v3
POST   /rest/v1/rpc/get_contacts_tags
POST   /rest/v1/rpc/get_tag_counts_for_contacts
POST   /rest/v1/rpc/get_contacts_with_outreach_v3
POST   /rest/v1/rpc/get_contact_stage_with_tab_info
```

## Settings Follow-Up Stages Endpoints

The Follow-up Stages settings route is:

```text
/:organization_id/settings/followups
```

July 2026 notes:

- The settings page was loaded directly at `/4a31fbee-f5a0-42d0-9f5f-10ed4ca50786/settings/followups`.
- Visible page state: heading `Follow-up Stages`, subtitle `Configure the stages for your follow-up workflow.`, stage chip `Wait 1 day`, action `Add New Stage`, toggle `Use Different Stages`, and status pause section `Turn off follow-ups by status`.
- The in-app browser still did not expose a raw HAR/network panel.
- I did not click `Save` on stage creation or timing edits because those actions write immediately to the live Supabase tables.
- The requests below were reconstructed from the active front-end bundle for this route.

### Load stage settings

The page loads active stages and follow-up boards directly from Supabase:

```http
GET https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/stages
GET https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/follow_up_boards
```

Observed filters:

```text
stages:
organization_id=eq.<organization_id>
status=neq.archived
order=index.asc

follow_up_boards:
organization_id=eq.<organization_id>
status=eq.active
order=position.asc,id.asc
```

The broader settings shell also loads:

```http
GET https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/user_organizations
```

Observed filter:

```text
organization_id=eq.<organization_id>
```

### Add new follow-up stage

Clicking `Add New Stage` opens a modal locally. The write happens when the modal is saved.

Supabase insert reconstructed from the front end:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/stages
```

Payload shape:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "board_id": "follow-up-board-uuid",
  "name": "",
  "time_after": 3,
  "days_after": 3,
  "index": 2,
  "status": "active"
}
```

Notes:

- `board_id` is the currently selected follow-up board.
- `index` is `current_active_stage_count + 1`.
- `name` can be blank; the UI renders labels like `Add to 1st follow-up stage` from the index.
- The modal supports `days` and `hours`.
- If unit is `hours`, the front end converts hours to fractional days before sending `time_after`.
- `days_after` is always `Math.floor(time_after)`, which means hour-based stages can have `days_after: 0`.
- The UI enforces a max of `10` active stages per follow-up board.

### Update wait duration

Clicking a `Wait X day(s)` chip opens an edit modal. Saving the edit updates the existing stage:

```http
PATCH https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/stages?id=eq.<stage_id>
```

Payload for changing `Wait 1 day` to `Wait 3 days`:

```json
{
  "time_after": 3,
  "days_after": 3
}
```

Notes:

- This is a direct Supabase table update.
- There is no separate `Save all` endpoint for this timing change; saving the modal writes immediately.
- For hours, the front end sends `time_after` as a fractional day and `days_after` as `0` until the value reaches at least one full day.

### Delete follow-up stage

The UI archives a stage rather than hard-deleting it:

```http
PATCH https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/stages?id=eq.<stage_id>
```

Payload:

```json
{
  "status": "archived",
  "index": null
}
```

After archiving, the front end reindexes later stages in the same board:

```http
PATCH https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/stages?id=eq.<stage_id>
```

Payload:

```json
{
  "index": 2
}
```

### Use Different Stages

The `Use Different Stages` flow creates or restores a separate follow-up board for a conversation status.

If no matching board exists:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/follow_up_boards
```

Payload shape:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "name": "Contact stopped replying",
  "match_rules": {
    "conversation_status": "has_replied"
  },
  "position": 1,
  "status": "active"
}
```

Then the front end copies the active stages from the default board:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/stages
```

Payload shape:

```json
[
  {
    "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
    "board_id": "new-follow-up-board-uuid",
    "name": "",
    "time_after": 1,
    "days_after": 1,
    "index": 1,
    "status": "active"
  }
]
```

After board create/update/delete, the app calls a DMTracker endpoint to redistribute or restamp contacts:

```http
POST https://app.dmtracker.ai/api/v1/follow-up-boards/restamp
```

Payload:

```json
{
  "org_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "op": "INSERT | UPDATE | DELETE",
  "board_id": "follow-up-board-uuid",
  "match_rules": {
    "conversation_status": "has_replied"
  }
}
```

Notes:

- The front end retries `restamp` up to `24` times while the response status is `partial`.
- This is the most important endpoint if we later change board logic via API, because it appears to reconcile contacts after board-level changes.

### Turn off follow-ups by status

The status-pause section uses a DMTracker app endpoint:

```http
POST https://app.dmtracker.ai/api/v1/organization/follow-up-settings
```

Get payload:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "action": "get"
}
```

Save payload:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "action": "save",
  "settings": [
    {
      "lead_status_id": 3,
      "lead_status_value": "lost",
      "follow_up_needed": false
    }
  ]
}
```

Notes:

- This endpoint is for pausing follow-ups by lead status, not for stage timing.
- Stage timing is managed through direct Supabase writes to `stages`.

## Follow-Ups Page Endpoints

The Follow-ups page route is:

```text
/:organization_id/follow-ups
```

July 2026 notes:

- The Follow-ups page was loaded directly at `/4a31fbee-f5a0-42d0-9f5f-10ed4ca50786/follow-ups`.
- Visible page state: heading `Follow-up Board`, subtitle `Click Username, Send follow-up, Mark as Done and repeat.`, search placeholder `Search contacts...`, tabs `Pending`, `Sent`, `Snoozed`, `Disabled`, stage `1st follow-up`, empty state `No contacts in this stage`.
- The in-app browser did not expose a raw HAR/network panel during this pass.
- The endpoints below were reconstructed from the current front-end bundle for the Follow-ups route.
- Read endpoints use DMTracker app API endpoints. Several write actions use direct Supabase table writes, so they should be treated carefully before automation.

### Load active follow-ups / Pending tab

```http
POST https://app.dmtracker.ai/api/v1/stages/get-paginated-contacts-v2
```

Default payload reconstructed from the Follow-ups front end:

```json
{
  "org_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "limit_size": 20,
  "page_number": 1,
  "sort_field": "contact_last_response_at",
  "specific_stage_id": null,
  "search_text": "",
  "sort_direction": "ASC",
  "tag_ids": null,
  "tag_filter_type": "any_of",
  "source_filter": "all",
  "conversation_status_filter": "all",
  "pipeline_stage_filter": null,
  "lead_status_filter": "all",
  "outreach_reason_filter": null,
  "assignee_user_ids": null,
  "assignee_filter_type": "any_of",
  "board_id": null
}
```

Usage:

- This powers the `Pending` tab.
- `specific_stage_id` is `null` for the full board, or a stage id for loading one stage.
- When there are multiple follow-up boards, the same endpoint may be called with `purpose: "all-boards-count"` and a concrete `board_id`.

Response shape is stage-based, consistent with the previous n8n capture:

```json
{
  "status": "success",
  "data": [
    {
      "stage_data": {
        "stage_id": "stage-uuid",
        "stage_index": 1,
        "stage_name": "1st follow-up",
        "time_after": 1,
        "contacts": [],
        "total_count": 0,
        "has_more": false
      }
    }
  ]
}
```

### Load sent follow-ups / Sent tab

```http
POST https://app.dmtracker.ai/api/v1/stages/get-paginated-markdone-followups-v2
```

Payload shape:

```json
{
  "org_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "limit_size": 20,
  "page_number": 1,
  "sort_field": "contact_last_response_at",
  "specific_stage_id": null,
  "search_text": "",
  "sort_direction": "ASC",
  "tag_ids": null,
  "tag_filter_type": "any_of",
  "source_filter": "all",
  "conversation_status_filter": "all",
  "pipeline_stage_filter": null,
  "lead_status_filter": "all",
  "outreach_reason_filter": null,
  "assignee_user_ids": null,
  "assignee_filter_type": "any_of",
  "board_id": null
}
```

Usage:

- This powers the `Sent` tab.
- The same endpoint was already observed in the n8n workflow notes.

### Load snoozed follow-ups / Snoozed tab

```http
POST https://app.dmtracker.ai/api/v1/stages/get-paginated-snoozed-contacts
```

Payload shape:

```json
{
  "org_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "limit_size": 50,
  "page_number": 1,
  "sort_field": "contact_last_response_at",
  "specific_stage_id": null,
  "search_text": "",
  "sort_direction": "ASC",
  "tag_ids": null,
  "tag_filter_type": "any_of",
  "source_filter": "all",
  "conversation_status_filter": "all",
  "pipeline_stage_filter": null,
  "lead_status_filter": "all",
  "outreach_reason_filter": null,
  "assignee_user_ids": null,
  "assignee_filter_type": "any_of",
  "board_id": null
}
```

Usage:

- This powers the `Snoozed` tab.
- Unlike the Pending/Sent/Disabled endpoints, the default `limit_size` reconstructed from the front end is `50`.

### Load disabled/no-follow-up contacts / Disabled tab

```http
POST https://app.dmtracker.ai/api/v1/stages/get-paginated-completed-followups
```

Payload shape:

```json
{
  "org_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "limit_size": 20,
  "page_number": 1,
  "sort_field": "contact_last_response_at",
  "specific_stage_id": null,
  "search_text": "",
  "sort_direction": "ASC",
  "tag_ids": null,
  "tag_filter_type": "any_of",
  "source_filter": "all",
  "conversation_status_filter": "all",
  "pipeline_stage_filter": null,
  "lead_status_filter": "all",
  "outreach_reason_filter": null,
  "assignee_user_ids": null,
  "assignee_filter_type": "any_of",
  "board_id": null
}
```

Usage:

- This powers the `Disabled` tab.
- The front end expects a flatter `data.contacts` and `data.total_count` response for this tab.

### Supporting reads on Follow-ups page

The Follow-ups page also loads:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_organization_users
GET  https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/follow_up_boards
GET  https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/pipeline_stages
GET  https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/organization_outreach
GET  https://app.dmtracker.ai/api/v1/organization/get-tags?organization_id=<organization_id>
```

Observed filters:

```text
follow_up_boards:
organization_id=eq.<organization_id>
status=eq.active
order=position.asc,id.asc

pipeline_stages:
organization_id=eq.<organization_id>
active=eq.true
order=position.asc

organization_outreach:
organization_id=eq.<organization_id>
status=eq.active
outreach_type=eq.reason
```

### Load paginated notes for a follow-up contact

```http
GET https://app.dmtracker.ai/api/v1/contact/get-notes-paginated?organization_id=<organization_id>&contact_id=<contact_id>&limit=10&offset=0
```

Usage:

- Used when opening/expanding notes for a contact on the Follow-ups board.

### Mark as Done action

Observed front-end behavior:

1. Computes `stage_due_date` from the current follow-up stage.
2. Inserts a row into Supabase table `follow_ups`.
3. Updates UI optimistically and logs failures to `follow_up_error`.

Supabase insert shape reconstructed from the front end:

```json
{
  "contact_id": "contact-uuid",
  "stage_id": "follow-up-stage-uuid",
  "user_id": "user-uuid",
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "created_at": "ISO timestamp",
  "stage_due_date": "ISO timestamp",
  "stage_index": 1
}
```

Notes:

- This is a direct Supabase table insert, not a DMTracker `/api/v1/...` endpoint.
- Duplicate inserts are handled client-side by checking Supabase error code `23505`.
- This action has business side effects and should not be automated without a deliberate confirmation flow.

### Mark No Follow-Up Needed / Disabled action

Observed front-end behavior:

```text
contacts.update({
  follow_up_needed: false,
  last_updated_by: <user_id>,
  closed_by: <user_id>,
  closed_at: <ISO timestamp>
}).eq("id", <contact_id>)
```

Notes:

- This moves/removes the contact from active follow-up work.
- Errors are logged to `follow_up_error`.

### Restore follow-up action

Observed front-end behavior:

1. Selects the latest row from `follow_ups` for the contact.
2. Deletes that latest `follow_ups` row.
3. Updates `contacts.follow_up_needed` back to `true`.
4. Clears `closed_by` and `closed_at`.

Relevant Supabase operations:

```text
follow_ups.select("*").eq("contact_id", <contact_id>).order("created_at", desc).limit(1).single()
follow_ups.delete().eq("id", <follow_up_id>)
contacts.update({ follow_up_needed: true, last_updated_by: <user_id>, closed_by: null, closed_at: null }).eq("id", <contact_id>)
```

### Snooze-related behavior

Observed front-end behavior:

```text
active_follow_ups.update({ skipped_follow_up: true }).eq("contact_id", <contact_id>).eq("organization_id", <organization_id>)
active_follow_ups.update({ skipped_follow_up: false }).eq("contact_id", <contact_id>).eq("organization_id", <organization_id>)
```

The front end also references:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_contact_stage_with_tab_info
```

Payload:

```json
{
  "p_contact_id": "contact-uuid"
}
```

Usage:

- Used to recover tab/stage information for a contact.
- Relevant to restore/undo flows.

## Contacts Page Endpoints

The Contacts page route is:

```text
/:organization_id/contacts
```

July 2026 notes:

- The Contacts page was loaded directly at `/4a31fbee-f5a0-42d0-9f5f-10ed4ca50786/contacts`.
- Visible page state: heading `Contacts`, subtitle `Find all of your organization's contacts`, search placeholder `Search contacts...`, empty state `No contacts found`.
- The in-app browser did not expose a raw HAR/network panel during this pass.
- The endpoints below were reconstructed from the current front-end bundle for the Contacts route.
- The page reads contacts mostly through Supabase RPCs, then uses DMTracker app endpoints for write/bulk actions.

### List contacts

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/list_contacts_light_v3
```

Default payload reconstructed from the Contacts front end:

```json
{
  "organization_id_param": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "page_param": 1,
  "limit_param": 20,
  "search_param": "",
  "sort_field_param": "created_at",
  "sort_direction_param": "desc",
  "p_outreach_reason": null,
  "p_require_last_message": false
}
```

Optional filters added only when active:

```json
{
  "tag_ids_param": ["tag-uuid"],
  "tag_filter_type_param": "any_of | all_of | is_empty | is_not_empty",
  "p_source_filter": "outreach | inbound | source-value",
  "p_conversation_status_filter": "status-value",
  "p_pipeline_stage_ids": ["pipeline-stage-uuid"],
  "p_lead_status_ids": [1],
  "p_follow_up_stage_ids": ["follow-up-stage-uuid"],
  "p_assignee_user_ids": ["user-uuid"],
  "p_assignee_filter_type": "any_of | all_of | is_empty | is_not_empty"
}
```

Notes:

- The page default sort is `created_at desc`.
- If sorted by `last_response_at`, the front end also sends `p_require_last_message: true`.
- If the organization setting `outreach_only_filter` is enabled, the initial load sends `p_source_filter: "outreach"`.
- The page size is `20`.

### Count contacts

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/count_contacts_v3
```

Payload mirrors the list request, minus pagination and limit fields:

```json
{
  "organization_id_param": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "search_param": "",
  "p_outreach_reason": null,
  "p_require_last_message": false
}
```

Optional filters are the same as `list_contacts_light_v3`.

Usage:

- Used to compute total contacts and total pages.
- The UI computes `totalPages` as `ceil(count / 20)`.

### Get tags for listed contacts

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_contacts_tags
```

Payload:

```json
{
  "contact_ids": ["contact-uuid"]
}
```

Usage:

- Called after `list_contacts_light_v3`.
- The front end maps returned rows by `contact_id` and merges `tags` into each visible contact.

### Get tag counts

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_tag_counts_for_contacts
```

Payload:

```json
{
  "organization_id_param": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786"
}
```

Observed mapped fields:

```json
{
  "tag_id": "tag-uuid",
  "tag_name": "tag-name",
  "tag_color": "#6B7280",
  "contact_count": 12
}
```

### Get all contact ids matching filters

```http
POST https://app.dmtracker.ai/api/v1/contact/get-all-ids
```

Payload shape reconstructed from bulk-selection logic:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "search": "optional-search-text",
  "tag_ids": ["tag-uuid"],
  "tag_filter_type": "any_of | all_of | is_empty | is_not_empty",
  "assignee_user_ids": ["user-uuid"],
  "assignee_filter_type": "any_of | all_of | is_empty | is_not_empty",
  "outreach_reason": "outreach-reason-id-or-value",
  "pipeline_stage_ids": ["pipeline-stage-uuid"],
  "lead_status_ids": [1],
  "source_filter": "outreach | inbound | source-value",
  "conversation_status_filter": "status-value",
  "follow_up_stage_ids": ["follow-up-stage-uuid"]
}
```

Usage:

- Used when the user selects all contacts across pages.
- Returns a `data.contact_ids` array when successful.
- The Contacts UI sometimes forces `source_filter: "outreach"` for outreach-style bulk operations.

### Bulk add contacts

```http
POST https://app.dmtracker.ai/api/v1/contact/bulk-add
```

Payload:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "contacts": [
    {
      "username": "instagram_username",
      "outreach_reason_id": "reason-uuid-or-null",
      "outreach_text": "message text or null",
      "outreach_label": "message label or null",
      "tag_ids": ["tag-uuid"]
    }
  ]
}
```

Observed response counters used by the UI:

```json
{
  "inserted_count": 0,
  "reactivated_count": 0,
  "converted_count": 0,
  "already_outreach_count": 0
}
```

### Bulk update contacts

```http
POST https://app.dmtracker.ai/api/v1/contact/bulk-update
```

Payload shape:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "contact_ids": ["contact-uuid"],
  "tags": {
    "mode": "add | remove",
    "tag_ids": ["tag-uuid"]
  },
  "pipeline_stage_id": "pipeline-stage-uuid-or-null",
  "lead_status_id": 1,
  "outreach": {
    "outreach_reason_id": "reason-uuid-or-null",
    "outreach_text": "message text or null",
    "outreach_label": "message label or null"
  },
  "assigned_to_user_id": "user-uuid-or-null"
}
```

Notes:

- Only fields selected in the bulk edit modal are sent.
- The front end chunks bulk updates: below 100 contacts it sends one chunk; above that it uses chunks up to 2,000 contacts.
- Response data is expected to include `succeeded_count` and `failed_count`.

### Update one contact's tags

```http
POST https://app.dmtracker.ai/api/v1/contact/update-tags
```

Payload:

```json
{
  "organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "contact_id": "contact-uuid",
  "mode": "add | remove",
  "tag_ids": ["tag-uuid"]
}
```

### Contact detail drawer support

The Contacts page reuses the contact detail drawer already mapped above:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_contact_details
```

Payload:

```json
{
  "p_contact_id": "contact-uuid",
  "p_organization_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786"
}
```

Observed detail fields consumed by the front end:

```text
creator_name
notes
timeline
pipeline_stages
automations
follow_up_info
lead_status_id
pipeline_stage_id
assigned_to_user_id
assigned_to_user_name
outreach_text
outreach_label
outreach_reason
```

## Outreach Page Endpoints

The current front-end bundle loads outreach contacts through Supabase RPC:

```http
POST https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/rpc/get_contacts_with_outreach_v3
```

Payload shape reconstructed from the front-end bundle:

```json
{
  "org_id": "4a31fbee-f5a0-42d0-9f5f-10ed4ca50786",
  "page_param": 1,
  "limit_param": 20,
  "search_text": "",
  "outreach_reason_filter": null,
  "p_require_last_message": false,
  "sort_field_param": "created_at",
  "sort_direction_param": "desc",
  "tag_ids_param": null,
  "tag_filter_type_param": null,
  "p_conversation_status_filter": null,
  "p_pipeline_stage_ids": null,
  "p_lead_status_ids": null,
  "p_follow_up_stage_ids": null,
  "p_assignee_user_ids": null,
  "p_assignee_filter_type": null
}
```

Outreach reasons/templates are loaded from Supabase:

```http
GET https://ybaaqyyghgafjlgpiwbk.supabase.co/rest/v1/organization_outreach
```

Observed selected fields and filters:

```text
select=id,outreach_type,outreach_reason,outreach_message,outreach_label
organization_id=eq.<organization_id>
status=eq.active
```

Custom tags are loaded through the DMTracker app API:

```http
GET https://app.dmtracker.ai/api/v1/organization/get-tags?organization_id=<organization_id>
```

## Data Model Hints

Based on the observed payloads and responses, the app appears to split data into:

- organization metadata
- pipeline stages
- follow-up boards
- contacts
- contact details
- tags
- assignees or members
- outreach reasons

Practical ids we will likely need later:

- `organization_id`
- `contact_id`
- `pipeline_stage_id`
- `stage_id`
- `board_id`
- `tag_id`
- user ids for assignment filters

## Field Differences Worth Noting

There is already one naming inconsistency between endpoints:

- pipeline endpoint uses `organization_id`
- follow-up endpoint uses `org_id`

So we should not assume request schemas are normalized across the product.

## Best Candidates For Next Reverse-Engineering Pass

If we want the minimum useful API surface for automation, inspect these next:

1. The endpoint that updates a lead's pipeline stage.
2. The endpoint behind "Mark as Done" on the follow-up board.
3. The endpoint used when a lead is snoozed or disabled.
4. The full response of `get_contact_details`.
5. The source of follow-up message templates, if they are stored in DMTracker and not only in n8n.

After the July 2026 Pipeline pass, item 1 is partially mapped:

```text
POST /api/v1/contact/update-pipeline-stage
```

## How To Re-Capture Quickly

### In DMTracker

1. Open DevTools.
2. Go to `Network`.
3. Filter on `Fetch/XHR`.
4. Reload the page.
5. Inspect the request tabs:
   - `Headers`
   - `Payload`
   - `Response`

### In n8n

The current workflow already exposes these configured calls:

- `Get Pipeline Deals`
- `Get Followup Status`
- `Get Contact Details`

This is useful because:

- payloads are visible without retyping them
- auth type is visible
- the endpoint names are already partially mapped into business meaning

## Open Questions

- What exact action moves a contact from one follow-up stage to the next?
- Is the "Mark as Done" action writing to a dedicated table or calling a custom API endpoint?
- Are follow-up messages stored only in n8n, or partially mirrored in DMTracker?
- Which endpoint should be treated as the source of truth for due follow-ups: DMTracker follow-up board or custom logic in n8n?

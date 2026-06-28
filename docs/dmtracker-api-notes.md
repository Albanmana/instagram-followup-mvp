# DMTracker API Notes

Captured on 2026-06-26 from:

- DMTracker web app network panel
- Existing n8n workflow configuration

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

## Known Organization

Observed organization id:

```text
bb75f257-d450-41f5-ab98-e60b1efd4fcf
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
POST   /api/v1/stages/get-paginated-completed-followups
POST   /api/v1/stages/get-paginated-snoozed-contacts
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
POST   /rest/v1/rpc/get_organization_users
POST   /rest/v1/rpc/get_contact_details
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

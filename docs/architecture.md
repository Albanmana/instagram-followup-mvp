# Full App Architecture

## Product Direction

The full version is a local-first Instagram follow-up assistant:

- First DM can stay manual.
- Follow-ups are scheduled from a local sequence.
- The browser extension is the Instagram operator.
- A local companion app owns state, timing, and reporting.

## Stack

### Browser Layer

- Chrome Extension, Manifest V3
- Popup or side panel UI
- Background service worker for orchestration
- `chrome.alarms` for periodic wake-ups
- `chrome.scripting` for Instagram automation

### Local App Layer

- Node.js
- Fastify for local HTTP API
- SQLite for persistence
- Drizzle for schema and queries

### Future AI Layer

- OpenAI or Ollama
- Sequence drafting
- Message personalization
- Reply classification

## Planned Data Model

### leads

- `id`
- `instagram_handle`
- `status`
- `created_at`
- `last_reply_at`

### sequences

- `id`
- `name`
- `max_steps`

### sequence_steps

- `id`
- `sequence_id`
- `step_index`
- `delay_hours`
- `message_template`

### lead_sequences

- `id`
- `lead_id`
- `sequence_id`
- `current_step`
- `next_send_at`
- `status`

### message_logs

- `id`
- `lead_id`
- `sequence_step_id`
- `message_body`
- `sent_at`
- `status`
- `error_message`

## Runtime Model

1. Extension registers or updates a lead.
2. Local app decides which step is due.
3. Extension opens Instagram and sends the next message.
4. Result is written to the local app.
5. Sequence stops on reply, limit reached, or repeated failure.

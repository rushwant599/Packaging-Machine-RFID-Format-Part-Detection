# RFID Parts Backend API

This document lists all HTTP and WebSocket endpoints provided by the backend. Paths are relative to the backend base URL.

## Root & Health

- GET `/`  
  Simple service check. Returns `{ message: string, status: "healthy" }`.

- GET `/api/health`  
  Detailed health: versions, cache status, and subsystem states (OPC UA, RFID OPC, OPC UA Event Listener).

## Customer HTML & Table Extraction

- GET `/api/customer-html`  
  Fetch the cached customer HTML (raw HTML response). Returns empty string if none.

- POST `/api/customer-html`  
  Upload and cache customer HTML.
  - Body: multipart/form-data with field `file`
  - Returns: uploaded HTML as the response body

- GET `/api/main-table-rows`  
  Extract rows from `<table class="main">` in the cached HTML.
  - Query params:
    - `as_html` (bool, default true) – return raw HTML vs plain text
    - `strip_whitespace` (bool, default false)
    - `with_meta` (bool, default false) – include `rowsMeta`
    - `duplicate_caption` (bool, default false)
  - Returns: `{ success, count, as_html, with_meta, duplicate_caption, rows? | rowsMeta? }`

## Format Data

- GET `/api/format-data`  
  Parse and return format data from the cached HTML. Returns `{ success, message, data, formatParts, formatCount }`.

- GET `/api/formats`  
  Return all formats data `{ formats }`.

- GET `/api/format-parts`  
  Return only the format parts list `{ formatParts }`.

- GET `/api/format-parts-per-format`  
  Parts grouped by format `{ formatPartsPerFormat }`.

- GET `/api/format-parts-per-format-with-index`  
  Combined entries (valueIndex + part) grouped by format `{ formatPartsPerFormatWithIndex }`.

## OPC UA (status/value) and Events

- GET `/api/opc-ua/status`  
  OPC UA connection/config status. Returns `{ enabled, available, connection_status, server_url, node_id, last_updated, current_value }`.

- GET `/api/opc-ua/value`  
  Current OPC UA node value. Returns `{ success, data, last_updated }`. Errors: 400/500/503/404 depending on state.

- GET `/api/opc-ua/events`  
  Recent OPC UA event bytes records.
  - Query params: `limit` (int, default 1000)
  - Returns: `{ success, running, count, events: [...] }`

- GET `/api/opc-ua/events/status`  
  OPC UA event listener status/config `{ enabled, running, configured_type, server_url, max_events, interval_ms }`.

## RFID: Live, Persisted, Inventory

- GET `/api/current-rfid-tag-ids`  
  Live tag IDs within retention window from the direct RFID inventory poller.
  - Returns: `{ success, tagIds, count, timestamp, retention_sec }`

- GET `/api/rfid-tag-ids`  
  Persisted tag IDs from DB (no live retention filter). Returns `{ success, tagIds, count, source: "db" }`.

- GET `/api/rfid-tags`  
  Persisted RFID tags with metadata. Returns `{ success, count, tags: [{ tag_id, first_seen, last_seen, read_count, ... }] }`.

- GET `/api/rfid-inventory/status`  
  Status of the direct RFID inventory loop (debug). Returns `{ running, tag_count, last_timestamp, retention_sec, reader }`.

## Live Event IDs (OPC UA Event Bytes)

- GET `/api/live-event-ids`  
  Unique hex IDs seen within a sliding time window from OPC UA event bytes.
  - Query params: `window_sec` (float, default 5.0; if <= 0, uses 8.0)
  - Returns: `{ success, running, count, window_sec, ids: string[], meta: { [id]: { first_seen, last_seen, count } } }`

## Format Part Assignments

- GET `/api/format-assignments`  
  All format-part ↔ RFID tag assignments.
  - Returns: `{ success, assignments: Record<string, string|object>, assignments_list: [...], count }`

- GET `/api/format-assignments/{format_part}`  
  RFID tag assigned to a specific format part. Returns `{ success, format_part, rfid_tag_id }`.

- POST `/api/format-assignments`  
  Create or update an assignment.
  - Body: JSON `{ format_part: string, rfid_tag_id: string }`
  - Returns: `{ success, message }`
  - Side effects: Broadcasts WS `assignments_update`.

- DELETE `/api/format-assignments/{format_part}`  
  Remove an assignment. Returns `{ success, message }`. Broadcasts WS `assignments_update`.

## Pictures

- GET `/api/pictures`  
  List all pictures.
  - Query params:
    - `include_meta` (bool, default false)
    - `part` (string) – filter by prefix `{part}_` or `{part}.`
  - Returns: `{ success, files: [string | { name, size, modified }], count, directory, mounted }`

- GET `/api/pictures/by-part/{format_part}`  
  List pictures for a specific format part. Returns `{ success, files: string[], count }`.

- POST `/api/pictures/{format_part}`  
  Upload a picture for a format part.
  - Body: multipart `file` or form `image_base64` (data URL or raw base64)
  - Returns: `{ success, filename, format_part, size }`
  - Static files are served at `/pictures/{filename}`.

## Config

- GET `/api/config`  
  Read current configuration. Returns full config object.

- POST `/api/config`  
  Update configuration (OPC UA, RFID inventory, event listener).
  - Body keys (any subset):
    - `OPC_UA_SERVER_URL`, `OPC_UA_NODE_ID`, `OPC_UA_ENABLED`
    - `RFID_INVENTORY_ENABLED`, `RFID_READER_IP`, `RFID_READER_PORT`, `RFID_READER_ANT`, `RFID_CURRENT_RETENTION_SEC`, `RFID_INVENTORY_INTERVAL_SEC`
    - `OPC_UA_EVENT_ENABLED`, `OPC_UA_EVENT_SERVER_URL`, `OPC_UA_EVENT_TYPE`, `OPC_UA_EVENT_INTERVAL_MS`, `OPC_UA_EVENT_MAX_EVENTS`
  - Side effects: Applies changes live (starts/stops/restarts components). Returns updated config.

## Access Control

- POST `/api/verify-password`  
  Simple password verification for Somic access.
  - Body: `{ password: string }`
  - Returns: `{ success: boolean, message: string }`

## WebSocket API

- WS `/ws/opc-ua`
  - Purpose: Live push updates for assignments, live event IDs, direct RFID inventory, and OPC UA events.
  - Initial snapshots on connect (if available):
    - `{"type":"assignments_update","assignments":{...},"count":number,"timestamp":number}`
    - `{"type":"live_event_ids","ids":[...],"count":number,"timestamp":number}`
  - Live message types:
    - `assignments_update` — same shape as snapshot
    - `live_event_ids` — `{ type, ids, count, timestamp }`
    - `rfid_inventory` — `{ type, tags, count, timestamp }` (from direct inventory loop)
    - `opc_event` — `{ type, timestamp, payload }` (raw event payload string)

## Static Files

- Static `/pictures/{filename}`  
  Serves stored picture files from the persistent pictures directory.

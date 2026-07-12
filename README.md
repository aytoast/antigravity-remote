# antigravity-remote

<p align="center">
  <strong>A fast mobile control surface for Google Antigravity.</strong>
</p>

<p align="center">
  Keep Antigravity running on desktop, then use a phone to open conversations, send prompts, switch models, manage scheduled tasks, and review agent output.
</p>

---

## Why this exists

Google Antigravity's desktop experience is powerful, but remote interaction can feel slow. `antigravity-remote` keeps the desktop runtime in place and adds a lightweight mobile interface for the actions that need to happen quickly.

The mobile client does not create a second conversation system. Desktop Antigravity remains authoritative for UI state and actions. The local daemon provides the bridge between the phone and the running desktop application.

## Capabilities

- Desktop-synced conversation sidebar and project grouping.
- CDP navigation into the same conversation opened on desktop.
- Prompt submission from mobile to the active desktop conversation.
- Model discovery and model switching through the desktop model picker.
- Scheduled task listing, details, event history, and enable/disable controls through CDP.
- Conversation pinning and archiving through desktop controls.
- Transcript search across visible desktop conversations.
- Markdown rendering for agent responses and timeline events.
- Floating conversation search and New Conversation actions.
- Loading skeletons for workspace, task, and conversation views.

## Architecture

```text
phone browser
    │
    ▼
React/Vite client
    │ HTTP
    ▼
local Node daemon :8787
    │
    ├── CDP → running Antigravity desktop UI
    ├── local reads → conversation databases and transcripts
    └── local reads → Gemini sidecar configuration where needed
```

### Desktop state

CDP is source of truth for actions and visible desktop state:

- conversation navigation
- prompts
- model selection
- pins and archive actions
- scheduled tasks
- desktop display filters

The mobile sidebar starts from conversation pills rendered by desktop. Local conversation databases are joined by ID for timestamps, workspace metadata, message content, and transcript search.

### Local data

The daemon reads local Antigravity data from the user's Gemini profile. It does not replace desktop state or maintain a second enabled/archive state for scheduled tasks.

## Requirements

- Windows
- Node.js 18 or later
- Google Antigravity running locally
- Antigravity desktop UI available to CDP

## Development

Install daemon dependencies:

```bash
npm install
```

Start local daemon:

```bash
node src/index.js
```

The daemon serves API and proxy traffic on `http://127.0.0.1:8787` by default.

Start mobile client in another terminal:

```bash
cd client
npm install
npm run dev
```

Vite serves the client on its usual development port. The client expects daemon API at port `8787`; override it with `VITE_API_BASE_URL` when needed.

## Configuration

Optional daemon variables:

```env
ANTIGRAVITY_PORT=3000
PROXY_PORT=8787
RELAY_WS_URL=wss://relay.antigravity.dev
```

`ANTIGRAVITY_PORT` is the local Antigravity web target. `PROXY_PORT` is the daemon's HTTP port. `RELAY_WS_URL` configures relay connection when remote relay mode is enabled.

## Project structure

```text
src/
  api.js             Express API routes
  desktopBridge.js   CDP discovery and desktop actions
  parser.js          Conversation and transcript reads
  sidecars.js        Scheduled task metadata reads

client/src/
  screens/           Workspace, conversation, and task views
  components/        Shared loading and UI components
  index.css          Application styles and responsive layout

test/
  sidebar-parity.test.js
```

## Verification

Run client checks:

```bash
cd client
npm run lint
npm run build
```

Run daemon tests:

```bash
npm test
```

## Current boundary

The desktop application must be running for CDP-backed actions. When desktop controls are unavailable, the daemon returns an explicit error instead of inventing or persisting a conflicting local state.

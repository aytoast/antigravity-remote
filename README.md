# antigravity-remote

remote access cockpit for antigravity agents. monitor, steer, and interact with local agents from any mobile device without exposing local ports. 

mimics the codex remote access architecture with local-first execution, secure relay, and qr code pairing.

## features

- **workspace browser**: view all local repositories and active projects (e.g., `wechat-crm`, `knowledge-base`, `artio`).
- **thread history**: access recent agent conversation threads per workspace.
- **live chat interface**: send text prompts, approve/reject agent actions, and view terminal streams in real time.
- **secure relay architecture**: local daemon dials out via WebSockets. zero inbound firewall rules or exposed ports.
- **qr code pairing**: instant, secure authentication between host desktop and mobile client.

## architecture

1. **host daemon (desktop)**
   - runs locally alongside the antigravity core.
   - scans `.agents` directories for historical threads.
   - establishes outbound-only WebSocket connection to the relay server.
   - generates pairing qr code containing session token and relay endpoint.

2. **relay server (cloud)**
   - lightweight signaling server (Node.js WebSocket / Supabase).
   - acts as pass-through message broker.
   - e2e encrypted; stores no local codebase data.

3. **mobile client (pwa)**
   - React/Next.js pwa with TailwindCSS.
   - scans host qr code to pair.
   - acts as remote control and terminal viewer.

## getting started

*coming soon.*

### development stack

- **client**: Next.js, React, TailwindCSS
- **relay**: Node.js, WebSockets
- **host**: Python/Node.js, Antigravity core integration

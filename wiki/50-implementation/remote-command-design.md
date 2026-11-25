---
title: Remote command design review
tldr: Why the HTTP command contract stays canonical, what Synergon adopted from Leitbild, and when to evolve discovery, routing and the scene model.
status: living
updated: 2026-11-26
tags: [architecture, agents, commands, discovery, mcp]
---

# Remote command design review

## Findings and decision

The 2026-11-26 review evaluated the HTTP endpoint, command registry, scene document, MCP adapter, live browser routing and operating guide. AI architecture, product, user and UX reviewers developed the first proposal. A separate architecture, reliability and workflow team then challenged it against running examples and the source. The result is recorded in [D-59](../20-decisions/decision-log.md#d-59).

The starting implementation already had a shared command engine, validated arguments, one-step undo and atomic document writes. Agents had six direct MCP tools and a flat catalogue in their instructions. MCP discarded structured edit and error data. Fuzzy matching could turn “monitor font height” into a move of the monitor stand. Giving one person aim reset omitted aims. A valid-looking but unavailable viewer code could become the remembered route. A returned picture could follow a failed application of the requested view.

The release adds a single scoped query, `discover`, in the existing registry. Exact operation IDs retrieve one existing schema. Searches return action-ready references and allow refinement when the limit is reached. The independent review removed a separate detail endpoint, a generic dispatcher, paging for the current rig, a provider abstraction and an instance migration. Both transports use the same dispatch and targeted lookups. New metadata describes the actual workspace, asset and live routing. Viewer codes and connection identities stay out of discovery.

## What transfers from Leitbild

Leitbild's first-party agents use `workspace_explore` and `workspace_call` over its native workspace and Pack API. Exploration uses the active Room scope and returns exact objects and operations. An unfamiliar operation can include its argument schema. Dispatch checks scope again. Agents can reuse an exact reference or call a familiar action without exploring first. An external MCP route serves a separate administration audience. This description was checked against Leitbild commit `e6ce2a7` and its agent discovery guide. [Workspace capability tools](https://github.com/michaelhil/leitbild/blob/e6ce2a7072ee0a851ed6c5806e1047ec6a6ccac1/apps/agents/src/tools/built-in/workspace-capability-tools.ts) · [Agent architecture](https://github.com/michaelhil/leitbild/blob/e6ce2a7072ee0a851ed6c5806e1047ec6a6ccac1/apps/agents/AGENTS.md)

Synergon has one workspace in scope per URL and one rig per workspace. A known operation stays a single call. An unfamiliar target can be found in one scoped query. A caller starting with an unfamiliar workspace can confirm it, search there, and then act. Exact IDs are reusable in that scope. Browser availability, the current pose and history are live values. A package rebuild can change the available IDs and limits. Command validation therefore remains at dispatch as well as discovery.

## Interfaces considered

| Interface | Where it fits | Decision |
|---|---|---|
| HTTP with a typed command registry | Predictable request and result data for scripts, UI and agents. OpenAPI can describe the HTTP envelope and generate SDKs. Dynamic targets still need runtime discovery. | Keep HTTP canonical. Generate an OpenAPI description from the registry when an SDK consumer needs it. [OpenAPI 3.2.1](https://spec.openapis.org/oas/v3.2.1.html) |
| MCP | Clients can connect to workspace tools with schemas, text, structured results and images. The July 2026 revision changes negotiation and removes the protocol session that Synergon uses for actor continuity and remembered pairing. | Keep the working 2025 and 2024 dialects for now. Adopt the official SDK and test a dual-era adapter after defining app-level actor continuity. [July 2026 MCP release](https://blog.modelcontextprotocol.io/posts/2026-07-28/) · [TypeScript SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28) |
| Host-side tool search | OpenAI and Anthropic can defer model-visible schemas. Scene geometry and current targets still need application discovery. | Revisit as the tool menu grows. Seven direct tools give the common actions an immediate entry point. [OpenAI tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) · [Anthropic tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) |
| Programmatic tool composition | Run loops and compose many API calls in a client-controlled execution environment. | Revisit for heavy analysis across many assets. Synergon's server executes validated scene commands. [Anthropic programmatic tool use](https://www.anthropic.com/research/advanced-tool-use) · [Cloudflare Code Mode](https://blog.cloudflare.com/code-mode-mcp) |
| Agent Skills and MCP Skills | Package reusable operating workflows for discovery on demand. The MCP extension is in beta. | Use the published guide and operating skill for now. [Agent Skills](https://agentskills.io/specification) · [MCP Skills](https://skills.extensions.modelcontextprotocol.io/specification/beta/skills) |
| A2A | Delegates work to an independent agent with task state, progress and artifacts. | Revisit if Synergon gains a separately running agent that accepts delegated jobs. [A2A architecture](https://a2a-protocol.org/latest/specification/) |

The current MCP route negotiates `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`. On `2025-06-18` and later it supplies structured content alongside text and image blocks. An SDK migration should check actor continuity for undo and browser Follow, validate scoped routing and test both old and new clients. The public workspace trust model currently permits edits by anyone with the workspace address. If access changes, check authorization consistently at discovery, dispatch and image delivery. [MCP structured tool results](https://modelcontextprotocol.io/specification/2025-11-25/server/tools#structured-content)

## Data model and evolution

| Concept | Current contract | Extend when |
|---|---|---|
| Workspace | A stable workspace ID scopes a history, command endpoint and live connections. Names are labels. | If workspaces gain roles or tokens, filter both discovery and execution by the same grants. |
| Asset definition | The manifest describes parts, surfaces, reference frames, controls, units and evidence. Discovery names the definition and its GLB SHA-256. The hash covers the binary GLB. | Add an explicit definition revision covering the manifest and package dependencies when an agent must cache capabilities across releases. |
| Asset instance | One placed rig is implicit. The scene document stores its pose by local joint ID and records the seated person as one value. | When a workspace can place a second asset, assign immutable workspace-local instance IDs. Reference members by instance plus local ID. Map existing entries to the original rig and preserve atomic undo across affected instances. |
| Operation and property | The registry owns each operation's argument schema and effect. Values that can be changed have units, limits and evidence in their domain. A single rig-level operation can affect several joints. | Introduce capability owners when a second asset type needs different operations. Discover only valid operations for that exact target. Use typed inputs and receipts per operation. |
| Scene version | Edit history has a workspace-local version. `expectedVersion` checks affected joints or the whole person. Browser view preferences and attachment to an agent are transient. | Introduce narrower person merge keys when independent concurrent aim editing needs them. Add a durable idempotency key only with scoped storage and a defined retry window. |

In a future scene with two display stations, a query for “monitor” should first name each eligible display or prompt for a more specific scope. After choosing the instance, the agent can inspect that monitor's capabilities and query one schema if needed. It should send the exact instance and member, with dispatch validating both applicability and the latest version. If bounded queries repeatedly overflow despite sensible filters, add stable pagination tied to the relevant definition and scope. Profile search before adding a larger index. Keep routine commands directly callable.

## Performance and failure evidence

The deployed-mode startup instructions decreased from 4,063 to 1,028 characters in a local comparison. The full tool-definition array increased from 16,403 to 17,613 JSON bytes with the new tool and guards. In a warmed local HTTP fixture, the overview was 982 bytes and one adjustment lookup 405 bytes, compared with the legacy full catalogue at roughly 28 kB. In 45 timed loopback samples per request, the medians for overview, lookup and geometry measurement were 0.16 ms, 0.16 ms and 0.19 ms. These samples measure server and local HTTP work. Production network latency, model reasoning time and browser picture waits are separate.

The HTTP and MCP paths share edit limits and no longer charge a single MCP query twice against the query budget. Resolving a command and reading geometry stay independent of browser image waits. View receipts distinguish dispatch, approval and capture, and image uploads are tied to the intended recipients of the request. Failed document writes remain dirty for a later flush. A successful edit receipt still precedes some disk writes. Crash durability and replay-safe relative edits would require additional guarantees and are separate decisions.

See the [remote command guide](../80-reference/remote-commands.md) for operational recovery, payload shapes and examples.

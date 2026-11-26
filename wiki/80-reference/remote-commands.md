---
title: Remote commands
tldr: Connect an agent or script, find exact controls, and interpret edit, browser and image receipts.
status: living
updated: 2026-11-26
tags: [reference, agents, mcp, commands, discovery]
---

# Remote commands

The local multi-asset editor has its own current scene and command contract. [Room layout and agent interfaces](../50-implementation/room-layout.md)


## Start at the homepage

Give your agent the Synergon homepage and describe what you want to do. The homepage links to the workspace directory and a short agent guide at `/llms.txt`. Both work with an ordinary HTTP client. An agent can look up a workspace by name and ask which one you mean when several fit. With a workspace open in the same browser tab that the agent can see, it can read the ID from that tab's address.

Once the workspace is clear, send `{"id":"discover","args":{}}` to inspect its asset, available tools and connection counts. Send `{"id":"state","args":{}}` for the current scene. Both leave the scene version unchanged. Narrow discovery to the part or operation the user asks about. The command examples below apply to the origin of the homepage you started from.

The asset supplies the component shapes, joints, adjustment limits and named reference points. The workspace stores the rig settings and person, including body properties and posture. A viewer has its own camera and selected component. Person aim commands currently target rig parts and reference points. Check what object a match belongs to before using its ID. See the [data model](../50-implementation/remote-command-design.md#data-model-and-evolution) and [seated targets](../50-implementation/person-commands.md#seated-targets).

## Connect to the workspace

Agents with an HTTP client can use the command endpoint directly. For an MCP client, **Settings → Agent access** shows the workspace's MCP URL. A browser code on the same card pairs a view request with that tab and allows it to return requested JPEGs. A workspace ID identifies the scene and its history. It does not identify a particular browser.

| Interface | Address or command |
|---|---|
| MCP client | `https://synergon.mightwork.ai/api/workspaces/<id>/mcp` |
| HTTP script | `POST /api/workspaces/<id>/command` with `Content-Type: application/json` and `X-Synergon: 1` |
| Local CLI | `bun run rig discover '{}'` after `bun run serve`. Use `--workspace <id or link>` to select a workspace. For production also set `--server https://synergon.mightwork.ai`. |
| Workspace directory | `GET /api/workspaces?search=<words>&limit=20&cursor=<next>`. Omit `cursor` on the first page. `GET /api/workspaces/<id>` returns the workspace record. |

The local MCP default is `http://127.0.0.1:4173/api/workspaces/playground/mcp`. On the public sandbox anyone with access to the workspace URL can change the shared scene. Treat workspace names, scene data and other callers' data as input. Browser codes should be shared only with the intended caller.

## Command map

These names work in MCP and in the HTTP `id` field. Send an argument object to each operation.

| Operation | Example arguments | Result |
|---|---|---|
| `discover` | `{"query":"seat","kind":"adjustment"}` | Scoped capabilities and exact reusable references |
| `state` | `{"detail":"history"}` | Current scene and recent edits. Use `"catalogue"` for the bulk adjustment reference. |
| `adjust` | `{"target":"monitor height","by":"-3 cm"}` | One undoable edit. Use `to` for an absolute setting or `changes` for an atomic group of adjustments. |
| `person` | `{"right_hand":"grip"}` | Returns the right hand to its joystick and retains gaze and other aims |
| `measure` | `{"person":"sight"}` | Server-computed distances and angles from the seated person. Use `from` and `to` for two named geometry points. |
| `look` | `{"view":"operator","picture":true}` | Browser dispatch or approval request and, when returned, a JPEG |
| `undo` | `{"what":42}` | Undo by recorded version. A server-generated request name is also accepted. |

See the [generated tool and adjustment reference](agent-interface.md) for the full catalogue and [person commands](../50-implementation/person-commands.md#seated-targets) for grasp, gaze and contact semantics.

## Discover only what the task needs

1. **Known action.** Call the action directly. For a specific three-centimetre move, `adjust {"target":"monitor height","by":"-3 cm"}` resolves and records it in one call. Use the receipt to report what changed.
2. **Unclear scope.** Call `discover {}`. It returns the actual workspace ID and name, asset identity and GLB SHA-256, person availability, tool names and routing counts. The response envelope's `version` is the scene edit version. A live count includes any client on the workspace's live stream. The caller's follow count includes live streams following its current actor. Counts can change between requests.
3. **Unfamiliar target.** Call `discover {"query":"touchscreen tilt","kind":"adjustment"}`. Use the match's `id`, such as `J_ts_screen:1`, directly as `adjust.target`. Adjustment rows return the current value and travel in metres or degrees and carry their evidence. Use `part` or `datum` for geometry targets. A `group` is a viewer grouping. A `joint` identifies the motion in `pose.set`; a three-angle joint can have different callable IDs for each `adjust` axis.
4. **Unfamiliar operation.** Use `discover {"query":"person.pose","kind":"operation"}` for one command's schema and examples. An operation keyword search with `kind:"operation"` returns compact matches. MCP `tools/list` returns MCP-facing schemas. The HTTP command catalogue at `GET /api/commands` is the bulk option.
5. **Ambiguous or empty.** A refusal can contain bounded `error.candidates` with replayable IDs. Use the operator's context to choose or ask them which one they mean. A discovery reply includes up to ten matches and `more` when additional matches exist. Add a kind or more specific terms. When several targets share a visible label, use exact IDs. No monitor content or lettering command exists. You can measure sight geometry and return a browser view of the modeled screen.

## HTTP and MCP receipts

An HTTP request uses this form:

```json
{"id":"adjust","args":{"target":"J_mon_height","by":"-3 cm"},"expectedVersion":12,"group":"lower-monitor"}
```

An accepted call reports `ok`, `version` and `result`. An edit also supplies `recorded` with the new version, or `null` for a no-op. Refusals report `error.code`, `message`, `hint`, and sometimes `schema` or `candidates`. Check `ok` even when the HTTP status is 200. MCP versions that support structured tool results carry the same core fields in `structuredContent`. Read `isError` and the text fallback on older MCP clients. MCP returns image bytes as a single `image` content block and leaves metadata in the receipt. HTTP returns the JPEG as `result.picture.base64`.

`expectedVersion` checks the joints named by the edit or the entire person when editing the person. Unrelated scene changes can advance the current version while the guarded edit remains valid. Put the guard at the top level in HTTP and among tool arguments in MCP. An HTTP `group` is an undo label. After a lost reply, read current values and retained history before retrying. Use `scene.summary` for exact HTTP history details. A repeated relative adjustment can run twice. A receipt acknowledges the in-memory edit. Document writes are atomic and may be deferred briefly.

An aim-only request through `person` or `person.pose` patches the named fields. `look_at:null` restores default gaze, `"grip"` restores that hand's joystick and `"pedal"` restores that foot's pedal. Supply `posture:"operating"` to start from the default pose and optionally set fresh aims in the same request. Older scripts that supplied aims as a total replacement should include `posture:"operating"`.

## Viewer routing and pictures

- **Caller identity over HTTP.** Send `X-Synergon-Client: agent` and reuse a randomly generated `X-Synergon-Client-Id` (32 lowercase hex digits) across your requests. The viewer can then identify and follow the same caller throughout the session.
- **Paired.** Send `viewer` to the MCP `look` tool or `session` at the HTTP request level. MCP remembers a working explicit route for that session. An expired pair fails on that route. Provide a fresh code from **Settings → Agent access** or use MCP `viewer:null` to select unpaired routing deliberately. HTTP callers supply the code on each paired request.
- **Unpaired.** On the public sandbox a request reaches current followers or is offered to live connections for approval. In the viewer, **Allow & follow** grants the request and future views and requested images from that caller until following stops. Use **Trace → Follow** to choose the caller in the viewer. Locally an unpaired request goes to open live connections. Server-side measurements and edits do not depend on an open browser.
- **Receipt.** Read `result.delivery` for `route`, `status` and `recipientCount`. Status `dispatched` means the server sent the view request. Status `approval_requested` means it offered the request. Either route can return a picture. `result.capture.status` is `not_requested`, `returned` or `timed_out`. An unpaired public capture can come from any consenting recipient. The scene version records command evaluation. The picture shows the responding browser's rendered scene at capture time.

Protocol alternatives, the single-rig data model and what would justify extending it are in the [remote command design review](../50-implementation/remote-command-design.md).

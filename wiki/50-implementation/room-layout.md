---
title: Multi-asset room editor
tldr: Run the local room editor, place versioned assets and use the same instance-qualified commands from the UI, HTTP, MCP or CLI.
status: living
updated: 2026-11-26
tags: [implementation, viewer, server, assets]
---

# Multi-asset room editor

## TL;DR

Run `bun run serve` and open the printed local address. Choose **Open viewer** to return to the last room. The workspace selector opens the directory, where **New room** creates an empty scene. A fresh installation also creates the furnished **Control room**. The local room store lives under `work/room-layout`. Set `--data <folder>` and `--port <number>` to run another independent installation.

## Arrange and measure

Use **Add object** to select a release. Drag an object in plan, use its rotation handle or enter exact placement in the left panel. Select a part to inspect its station's adjustments. Change the release to swap the selected placement. **Plan** shows dimensions, **3D** opens the orbit view, and **Fit** frames the room. The **Measure** tab compares qualified points and the selected object's projected footprint with the doorway. One operator can occupy a station. The furnished room pairs two north-facing stations with a shared wall display. The display's adjustable mount sets its height, and the station monitors' own joints set their heights. The freestanding screen faces the pair from the east side.

A scene uses a rectangular floor with east and north coordinates measured from its southwest corner. Door and window offsets are measured east from the west wall. Positive yaw turns east towards north. Every asset declares a floor anchor. Rig B's deck origin sits 0.20 m above that anchor. Doorway approach is the shortest distance from the threshold to one rotated bounding footprint. The unblocked opening is the longest continuous interval at the threshold after subtracting every footprint. A doorway measurement includes the defining points and edges. These are plan projections, including overhanging features.

## Agent entry point

The installation homepage links to `/llms.txt` and advertises `/api/commands`. The guide describes discovery, target qualification, units, writes and undo. All paths in this table are relative to that installation. Substitute the workspace UUID for `{id}`.

| Operation | Interface |
|---|---|
| Find a room by name | GET `/api/workspaces?search=Control%20room` |
| Read the scene revision and objects | GET `/api/workspaces/{id}/state` |
| Resolve names or inspect one placement | GET `/api/workspaces/{id}/discover?query=monitor` or supply `instance` |
| Inspect installed pins or command schemas | GET `/api/catalog` or GET `/api/commands` |
| Run one operation | POST `/api/workspaces/{id}/command` with JSON, `X-Synergon: 1`, `id`, `args` and optional `expectedVersion` |
| Subscribe or reconnect | GET `/api/workspaces/{id}/live` for authoritative scene snapshots |
| Use MCP | JSON-RPC at `/api/workspaces/{id}/mcp`; set `SYNERGON_WORKSPACE_MCP` to that full address for the repository configuration |
| Use the command line | `bun run rig discover '{"query":"monitor"}' --workspace <room URL>` |

## Ownership and persistence

A release identifies its asset, version and SHA-256 digest of its ordered file inventory. Model geometry, manifest and operator package dependencies belong to the release. Fetch `inventory.json` next to its model URL to inspect file digests. An instance owns its placement and joint overrides. Address a point with an instance and its local member ID. The operator carries an explicit host and host-local targets. Each viewer owns its own camera and selection.

An accepted edit writes the scene and its undo record in the same SQLite transaction. Pass the revision on which an edit is based to detect overlapping changes. The receipt gives the recorded version for targeted undo. Changes to separate placements can proceed independently. Reconnect reads the current snapshot. An unsupported scene format or unavailable pin identifies what must be supplied. The local milestone uses newly authored rooms.

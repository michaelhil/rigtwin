---
title: Workspaces on the server
tldr: The server keeps many shared scenes, called workspaces, instead of one. Each has a random link, its own history and undo, its own live view, activity line and agent address. Anyone with a link can use, rename or delete it; making new ones is rate-limited; nothing is ever deleted for good by the server. Live on the public site since 2026-11-25.
status: living
updated: 2026-11-25
tags: [server, workspaces, api, storage, limits, implementation]
---

# Workspaces on the server

## TL;DR

- **A workspace is one shared scene**, exactly what the single "Playground" was: the rig's adjustments, the person, the last 200 changes with undo, the activity line, Follow and the consent question, pictures and the agent (MCP) address. There can be thousands; each is kept apart from the others.
- **The link is the key.** A workspace's id is a random 36-character code (a UUID, 122 random bits), so it cannot be guessed. Anyone who has the link can look, change, rename or delete it. There are no accounts.
- **The old Playground becomes one workspace**, named "Playground". On a data folder with no workspace the server makes it by itself, so the landing page is never empty.
- **Making workspaces is limited**: 10 an hour per visitor, 30 an hour per network block, 200 a day in all, 5,000 in all, and none when the disk is nearly full.
- **Delete moves, it does not erase.** The folder goes to `deleted/` on the server and nothing reads it or removes it. The owner can bring it back by hand ([how](#bringing-a-deleted-workspace-back)).
- **Status:** live on the public site since 2026-11-25; the earlier shared scene is the workspace "Playground" ([deployment](deployment.md)).

The workspace selector is at the top of the viewer’s left panel. Its **Copy workspace link** command shares the workspace address. **Copy view link** in the footer includes the current camera, selection and adjustments. Open **Settings → Agent access** to find this workspace’s agent address and the open viewer’s browser code. [The viewer](viewer.md#workspaces-on-the-page), [host setup](server-and-host-setup.md), [agent interface](../80-reference/agent-interface.md).

## What is stored

Everything lives in the server's data folder (`/var/lib/synergon` on the host, `../synergon-projects` next to the repository on the laptop):

| What | Where | Notes |
|---|---|---|
| The list of workspaces | `workspaces.sqlite` | A small database file (SQLite, built into Bun, nothing to install). One row per workspace: id, name, created, changed. |
| One workspace's scene | `workspaces/<id>/doc.json` | The pose, the person and the last 200 changes. Written whole, to a temporary file first, then renamed, so a crash never leaves half a file. |
| A deleted workspace | `deleted/<id>/` | The folder as it was. Not shown, not served, never removed by the server. |
| The secret | `secret` | One for the whole server. It turns a browser's random id into the short author label ("Person · 3f2a"). The same label therefore appears in every workspace. |

A name never becomes part of a file path: a folder is named by the id only, and the server checks every id against the exact pattern of a random UUID (lower case, version 4) before it builds any path. Anything else, including `manage`, `..`, an upper-case id or an id with a percent sign, answers 404 `no_workspace` without touching the disk.

A **name** is 1 to 80 characters. The server trims it and removes control characters and invisible direction marks. Empty or missing at creation gives "Untitled workspace". Names need not be unique.

## The API

Everything is JSON. An error looks like `{ "ok": false, "error": { "code", "message", "hint" } }`. A write (POST, PATCH, DELETE) needs the header `X-Synergon: 1`, and a body at most 2 kB.

| Request | Answer |
|---|---|
| `GET /api/workspaces?search=&limit=&cursor=` | `{ workspaces, next, total }`, newest first. `search` is a case-insensitive part of the name. `limit` is 1 to 100 (default 50). `next` is the `cursor` for the following page, or `null`. `total` counts the matches. |
| `POST /api/workspaces` with `{ "name"? }` | 201 and the record. 429 `rate_limited` or 507 `full`, each with a plain hint. |
| `GET /api/workspaces/<id>` | The record `{ id, name, created, changed }` (times in ISO 8601; `changed` is the last edit or rename), or 404 `no_workspace`. |
| `PATCH /api/workspaces/<id>` with `{ "name" }` | The new record. Every open live stream of that workspace gets the event `workspace` with it. |
| `DELETE /api/workspaces/<id>` | 204. Every open live stream gets the event `deleted` and is closed. The workspace answers 404 from then on. |
| `GET /api/workspaces/<id>/live` | The live stream (server-sent events). The first event, `session`, now also names the workspace. |
| `POST /api/workspaces/<id>/command` | One command, as before. |
| `POST /api/workspaces/<id>/mcp` | The agent address of this workspace ([agent interface](../80-reference/agent-interface.md)). |
| `POST .../follow`, `GET .../trace`, `POST .../picture` | As before, for this workspace. |
| `GET /api/commands`, `GET /api/health` | The same for the whole server. |

The old addresses of the single shared scene (`/api/live`, `/api/command`, `/api/mcp`, `/api/follow`, `/api/trace`, `/api/picture`) are gone. They answer 404 with the hint "use `/api/workspaces/<id>/...`".

On a **local** server only, the word `playground` stands for the oldest workspace named "Playground" (`http://127.0.0.1:4173/api/workspaces/playground/mcp`). It lets `.mcp.json` and `bun run rig` work on the laptop without an id. A server on the public site never accepts it.

## Kept apart

Each workspace has its own document, history and undo, its own live streams and session codes, its own trace and activity line, its own followers, and its own agent sessions. A change, an undo, a group name, a browser code or a picture asked for in one workspace never reaches another. What is shared is the server: the asset and the person's packages, the secret, and every limit below that counts requests, streams or disk.

## Loading and dropping

Only the list is always in memory. A workspace's scene is **loaded on its first request**. After 10 minutes with no open stream and no request it is written to disk and **dropped from memory**. At most 200 are loaded at once: when a new one is needed, the least recently used one that has no open stream goes first. An idle workspace therefore costs disk only. A workspace with an open page is never dropped.

## Limits

All numbers are in `server/limits.ts`, each with its reason next to it. The ones for workspaces:

| Limit | Number | Why |
|---|---|---|
| New workspaces per visitor | 10 an hour | Enough to try the site and make a few scenes; too few to fill the disk from one address. |
| New workspaces per network block | 30 an hour | A school or an office shares one block, so three times a visitor. |
| New workspaces in all | 200 a day | A crowd adds at most 200 small folders a day, so a flood is noticed long before the disk is near full. |
| Workspaces in all | 5,000 | Nothing is deleted automatically, so the number only grows. 5,000 busy scenes are about a gigabyte. The owner raises it or clears out when creation answers "full". |
| Creation with a nearly full disk | refused (507 `full`) | The same disk guard as for edits: less than 5 % or 200 MB free. |
| Rename and delete | the existing edit limit (60 a minute per visitor) | They are edits like any other. |
| Workspaces in memory | 200 | A scene with history and streams is some hundreds of kB. |
| Idle before dropping | 10 minutes | Long enough that a tab left open stays warm, short enough that a quiet server holds few. |
| Name | 80 characters | Keeps the workspace selector and phone list readable. |
| Request body for a name | 2 kB | 80 characters, escaped, is well under it. |
| List page | 50 by default, at most 100 | A page stays small whatever the visitor asks. |

The limits apply on the public site (deployed mode) only; a local server has none, as before. Live streams, edits, queries, pictures and the disk guard stay global: 150 streams in all, 6 per visitor, whichever workspaces they are in.

## What happens on delete

1. What is waiting to be written is written, so the folder holds the scene as it was.
2. The folder `workspaces/<id>/` is moved to `deleted/<id>/` and the row leaves the list.
3. Every open live stream of that workspace gets the event `deleted` and is closed. Any picture an agent is waiting for is given up.
4. From then on every address of that workspace answers 404.

Nothing in the server reads, lists or removes `deleted/`. Anyone with the link could delete a workspace, which is why it is a move and not an erase.

### Bringing a deleted workspace back

By hand, on the host, as the owner (the server can stay running):

1. Find the folder: `ls /var/lib/synergon/deleted/` (the folder name is the workspace's id, the one in its old link).
2. Move it back: `mv /var/lib/synergon/deleted/<id> /var/lib/synergon/workspaces/<id>`.
3. Put its row back. The id and the times are the old ones; the name is yours to choose:
   `sqlite3 /var/lib/synergon/workspaces.sqlite "INSERT INTO workspaces (id, name, created, changed) VALUES ('<id>', '<name>', '<time>', '<time>')"` with times such as `2026-11-25T12:00:00.000Z`. If `sqlite3` is not installed, `bun -e` with `bun:sqlite` does the same.
4. Open `https://synergon.mightwork.ai/workspaces/<id>`. The old link works again. In the list it stands at the top, because the list is ordered by when a row was made.

(The scene inside is exactly as it was at the delete.)

## Starting on an empty data folder

If the data folder has no workspace, the server makes one named "Playground" on start. When an older server had left `playground/doc.json` there and the file can be read, that scene becomes the Playground; otherwise it starts empty with the default person. The one-off cutover script places the old public scene the same way, by calling the server's own `createWorkspace()` and printing the new id (the owner's cutover runbook, kept outside the repository).

## How it was checked

`bun test server`: 66 tests, 27 of them for workspaces. They cover creating (names, bad requests, size and header checks), the list (order, search, paging), reading, renaming with the event reaching a second open page, deleting (event, closed stream, 404 afterwards, folder in `deleted/`), two workspaces kept apart (changes, undo, view codes, agents), every creation limit and the disk guard, bad ids (path tricks, `manage`, upper case), loading on demand, dropping when idle and the order of dropping, the first start on an empty folder, and bringing a deleted workspace back by hand as described above.

---
title: Portable room projects
tldr: Create a local project, restore named scene versions, and transfer exact asset releases and assessment inputs between installations.
status: living
updated: 2026-11-26
tags: [implementation, viewer, server, assets]
---

# Portable room projects

Open **Projects** on a local installation. **New project** creates a folder with its first empty scene. A folder such as `Customer/Operations/Phase 2` can sit inside another project. Choose a scene name to enter its live workspace. The workspace's project link returns to its scene list. **Add scene** offers an empty or furnished starting layout.

## Project record and recovery points

Edit **Project record** to save the entire `project.md`. Use headings for purpose, goals, requirements, issues, pipeline, chosen standards and predecessor projects as needed. Additional fields, Markdown and free-form notes travel verbatim. Assessment profile settings and frozen runs also travel when present.

**Named versions** saves a complete snapshot of one scene and its source revision. Compare a snapshot with the current layout or another saved version of the same scene. Restore replaces that scene and starts a new undo interval. Subsequent edits can be undone. Other scenes and saved versions retain their state.

**Project settings** changes the title or moves the folder. The local data directory contains `projects/<folder>/project.json`, `project.md`, `scenes/` and `versions/`. Projects containing assessments also have `assessment.json`. The scene file holds the installation's single writable layout and undo history. Moving the complete folder keeps project and scene IDs. A receiving installation issues its own workspace handles.

## Transfer

Under **Export project**, select **Embed pinned files** or **Link exact release** for each listed pin. Each release appears once across live scenes, named versions and saved assessment inputs. Embedding includes the release inventory, model, manifest and the station's operator files. Every model, motion clip, shape file and texture requested by the viewer must resolve within the release inventory. Attribution links in source records are preserved. A mixed package contains bytes for embedded pins and exact IDs for linked pins. Restricted releases require links.

On a second local installation choose **Import project** and select the package. Before making a folder visible the importer checks the complete project, verifies embedded bytes, resolves exact linked releases, validates poses and replays saved assessments. A missing pin identifies the release to install from an approved library. An identical project re-import opens its existing copy. If the package supplies files for a previously linked release, the importer saves those files with that copy so they remain available after restart. If the ID already belongs to divergent content, **Import as separate copy** creates a fresh project and workspace handles. Source scene IDs remain valid for its named versions and assessment runs.

For an offline demonstration, start a second server using `bun run serve --port 4174 --data <empty-directory> --empty-library`. Import an embedded package, reopen the scene and make a new edit. Restart with the same data directory and `--empty-library` to reopen it. Public installations expose room workspaces only. The local project directory and its contents are outside the public asset bundle.

## Agent interfaces

Read `GET /api/projects/commands` for argument schemas. Send `POST /api/projects/command` with a JSON body `{"id":"project.list","args":{}}`, a JSON content type and the `X-Synergon: 1` header. Local MCP clients can connect to `/api/projects/mcp` and inspect `tools/list`. Open the returned workspace ID at its [room command interface](room-layout.md) to edit or measure a scene.

```sh
bun run rig project.list
bun run rig project.create '{"name":"Operations study","folder":"Operations/Phase 2"}'
bun run rig project.open '{"project":"<project UUID>"}'
bun run rig project.save '{"project":"<project UUID>","scene":"<scene UUID>","name":"Surveyed"}'
bun run rig project.export '{"project":"<project UUID>","defaultMode":"embed","file":"study.synergon.json"}'
bun run rig project.import '{"file":"study.synergon.json"}' --server http://127.0.0.1:4174
```

CLI file paths refer to the machine running the CLI. An exported package has format `synergon-project/1`. Workspace handles, command histories, camera preferences and session codes stay on the originating installation.

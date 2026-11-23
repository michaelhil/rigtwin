# rigtwin — instructions for AI agents

The wiki is the single source of truth for this project. Start there:

1. `wiki/00-overview/summary.md` — what this is and where it stands.
2. `wiki/index.md` — every page with a one-line summary (generated: `bun run wiki index`).
3. `wiki/60-lessons/lessons-learned.md` — read before changing how assets are built.
4. `wiki/40-method/asset-contract.md` — the contract every asset must satisfy.

To build or change a 3D asset, use the Agent Skill `modeling-3d-assets-from-references`
(`.claude/skills/`) and the agent definitions in `.claude/agents/`.

## Commands

```
bun install                  # the only install step
bun run build                # parameters + sources -> assets/rig-b/build/rig-b.glb + manifest
bun run check                # every check; must pass before a commit or a deploy
bun run render --set sheet   # contact sheet (also: ortho, ids, groups, matched, focus, wiki)
bun run serve                # viewer at http://127.0.0.1:4173/
bun run wiki index|lint|build
bun run deploy --dry-run     # then `bun run deploy` (see wiki/50-implementation/deployment.md)
```

## Rules that are easy to break

- Numbers live in `assets/<asset>/params/*.toml` with class, range and evidence; never in source code.
- No brand, client or customer names from the source photographs anywhere in the repository,
  including image pixels and file names. `bun run check` scans for them.
- `private/` (unmasked photos, cameras, planning archive) and `work/` (agent working files) are
  never committed. Published photographs are the masked copies under `wiki/img/photos/`.
- After finishing a piece of work: update the wiki pages it affects, append to `wiki/log.md`,
  run `bun run wiki index`, `bun run wiki lint` and `bun run check`.

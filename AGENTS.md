# Harness Desktop repository instructions

## Mandatory release path

When the user asks to package, publish, upload, release, mirror, or ship an update, do **not** invent or manually reassemble release commands. Read `docs/RELEASING.zh-CN.md`, then use the repository-owned resumable publisher:

```powershell
npm run release:publish -- plan --version <package.json version>
npm run release:publish -- run --version <package.json version>
```

A later session resumes the same state with the identical `run` command (or `resume`). Inspect progress with:

```powershell
npm run release:publish -- status --version <package.json version>
```

The publisher is the single source of truth. It owns this immutable order:

1. clean committed source and local release/Windows gates;
2. fast-forward `main` and create the one immutable product tag;
3. GitHub platform builds and cloud-only private-draft recovery when repository Actions cannot publish directly;
4. public desktop release, signed Android, then signed production components;
5. exact 18-asset `release-manifest.json`;
6. CNB Runner mirrors directly from GitHub—never upload local binaries to CNB;
7. signed stable component feeds are promoted last, then synchronized to CNB;
8. final GitHub/CNB state is recorded in `.release-state/v<version>-publish.json`.

Never move/recreate a published tag, replace a published asset, overwrite an old version, bypass digest/signature/snapshot gates, upload Actions artifacts through the local machine, or promote stable feeds before both clouds are ready. If authentication is missing, ask the user to complete `gh auth login` or CNB login personally; never request or handle passwords, tokens, OTPs, signing keys, or keystores.

Do not run individual publication commands merely because an earlier phase failed. Re-run the publisher so it resumes from its atomic state file. Modify the publisher/workflows only when fixing the shared release mechanism itself, and add/update `tests/release-publisher.test.cjs` for such changes.

## Working tree safety

Other sessions may have unrelated uncommitted changes. Do not discard, overwrite, stage, or commit them. The publisher intentionally refuses a dirty tree; finish and commit the requested product changes before starting a release.

## Repository discovery and local Git

This checkout is not the upstream DSH monorepo and does not have top-level `apps/` or `packages/` directories. Discover from the repository root with the filesystem glob tool before narrowing the search root; do not call glob against an assumed directory that has not been observed.

On Windows, plain `git` may be absent from the inherited PowerShell `PATH`. Use the repository-owned `third_party\\mingit\\cmd\\git.exe` executable for source inspection. Do not install Git, mutate the user PATH, or treat a missing global command as evidence that this checkout is not a Git repository.

If a low-cost delegated route fails before producing output, do not repeatedly spawn replacements or fill an Agent Team blindly. Preserve the failure evidence, inspect team status, reuse or retire the exact failed member as appropriate, and continue on the main route when the review is still necessary.

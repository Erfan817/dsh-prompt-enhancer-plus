# Development and pull requests

## One checkout, short-lived branches

Reuse your existing clone. Do not clone the repository or create a worktree for every task. Use a temporary worktree only when concurrent tasks genuinely require separate working directories.

Before starting, check `git status`. Commit or otherwise deliberately preserve pending work before switching branches; never reset or clean it automatically.

```sh
git fetch origin --prune
git switch main
git pull --ff-only origin main
git switch -c feat/short-task-name
```

Make focused changes. Run relevant tests, `git diff --check`, and review the diff for secrets, local paths and unrelated changes before committing. Dependencies, caches, local Skills, credentials and packaged archives must not be committed.

```sh
git add <specific-files>
git commit -m "feat: describe the change"
git push -u origin HEAD
gh pr create --base main
```

Use the PR template. GitHub Actions runs the full regression matrix, native plugin validation/tests and package checks without model credentials. `CI required` must pass. Green CI does not prove visual UI behavior or actual model quality; document those limits. Never use `pull_request_target` to execute untrusted PR code with repository secrets.

## Review and merge

- No direct pushes to `main`, force pushes, automatic merges or unilateral bypasses.
- A human decides whether to merge after reviewing changes and checks. For a solo repository, GitHub does not permit authors to approve their own PR; do not require a second approver unless another maintainer is available.
- GitHub deletes the remote feature branch after merge. Locally, fetch with `--prune`, update `main`, then delete only branches whose PR merge you have confirmed.
- Squash-merged branches may not be recognized by `git branch -d`. Check the PR and preserve any extra commits before considering manual deletion.
- Never delete worktrees with pending work. Removing a branch alone does not remove Git history or materially reduce disk usage.

## Stable plugin versus development files

Daily DSH use should install a tested `.tgz` package through the plugin manager, **not** link this checkout. Switching development branches must not change installed runtime files. Keep the currently deployed package as rollback material until a replacement has been verified; do not accumulate per-task clones or archives.

Update the stable plugin deliberately after the PR is merged and CI is green. A development snapshot may be installed for a specific test, but label it as a snapshot rather than a published release. Do not automatically deploy PR code from CI.

## Local storage

Use one shared `node_modules` directory per checkout; do not reinstall dependencies unless the lockfile changes. Only create package artifacts for an actual installation or release. Inspect caches and old artifacts before deleting them; do not delete source, unmerged branches or user configuration for space reclamation.

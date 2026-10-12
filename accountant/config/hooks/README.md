# Default SVN Commit Hooks

The default commit-hook templates used by the Accountant service. Every
repository created by `server/subversion.js` gets copies of these scripts in
its `hooks/` folder (marked executable) immediately after `svnadmin create`.

Keeping the templates here - on the client side, outside the SVN container
image - means hook behaviour can be changed by editing this one folder; new
repositories pick up the changes without rebuilding any image.

## Included hooks

| Hook | Purpose |
|------|---------|
| `pre-commit` | Rejects commits containing a single file larger than `SVN_MAX_FILE_SIZE_MB` (default 500 MB). |
| `post-commit` | Logs each commit (revision, author, message) to the container's stdout - visible via `docker logs`. |
| `pre-revprop-change` | Denies all revision property changes so commit metadata cannot be rewritten. |

## Customizing

- **Add / remove / edit templates** in this folder. Only regular files whose
  names look like SVN hook names (lowercase letters and digits separated by
  single hyphens) are installed; anything else is skipped with a warning.
- **Use an entirely different folder** by setting the `SVN_HOOKS_DIR`
  environment variable on the accountant service (e.g. in its docker-compose
  file). Pointing it at a missing or empty folder installs no hooks at all.

Scripts run as the `apache` user inside the SVN container and must be POSIX
sh (the image is Alpine-based). Line endings are normalized to LF before
installation, but keep them LF in this repository anyway.

Note: these scripts are copied into each repository at creation time -
editing a template does not update hooks already installed in existing
repositories.

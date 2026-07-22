#!/bin/bash
# SessionStart hook: ensure the equities repos are present and sync the
# source-of-truth skills (from the News-agent clone) into the global skills
# dir, so Claude loads the repo version instead of a stale container copy.
#
# Robustness (option 1): the skills live only in the News-agent repo, so we
# locate that clone by ABSOLUTE PATH and do NOT depend on CLAUDE_PROJECT_DIR
# (which points at the session's primary dir, not necessarily News-agent).
# Any failure raises a LOUD warning instead of dying silently.
set -uo pipefail

# Hook protocol: emit control JSON first.
echo '{"async": false}'

HOOK="session-start"
WARNINGS=0

warn() {
  WARNINGS=$((WARNINGS + 1))
  # Print to BOTH streams so it shows in hook output and in session context.
  echo "WARNING  [$HOOK hook] $*" >&2
  echo "WARNING  [$HOOK hook] $*"
}

# We run without 'set -e'; catch any UNEXPECTED error and surface it.
trap 'warn "unexpected error at line $LINENO: ${BASH_COMMAND}"' ERR

# ---------------------------------------------------------------------------
# 1) Ensure repos are present / updated (non-fatal).
# ---------------------------------------------------------------------------
REPOS=(
  "gustavosantosfranco-netizen/news-agent:$HOME/news-agent"
  "gustavosantosfranco-netizen/equities-store:$HOME/equities-store"
)

for repo_info in "${REPOS[@]}"; do
  IFS=':' read -r repo_path repo_dir <<< "$repo_info"
  echo "Setting up $repo_path -> $repo_dir"
  if [ -d "$repo_dir/.git" ]; then
    git -C "$repo_dir" fetch origin \
      || warn "git fetch failed for $repo_dir (continuing)"
  else
    git clone "https://github.com/$repo_path.git" "$repo_dir" \
      || warn "git clone failed for $repo_path (continuing)"
  fi
done

# ---------------------------------------------------------------------------
# 2) Sync skills from the News-agent clone (source of truth).
#    Locate it by absolute path; try known candidates in priority order.
# ---------------------------------------------------------------------------
SKILLS_SRC=""
for cand in \
  "$HOME/News-agent/.claude/skills" \
  "/home/user/News-agent/.claude/skills" \
  "$HOME/news-agent/.claude/skills" \
  "/home/user/news-agent/.claude/skills" \
  "${CLAUDE_PROJECT_DIR:-}/News-agent/.claude/skills" \
  "${CLAUDE_PROJECT_DIR:-}/.claude/skills"; do
  [ -n "$cand" ] || continue
  if [ -d "$cand" ] && compgen -G "$cand/*/" > /dev/null; then
    SKILLS_SRC="$cand"
    break
  fi
done

if [ -z "$SKILLS_SRC" ]; then
  warn "skills source not found (News-agent clone missing?) -- GLOBAL SKILLS NOT SYNCED; Claude may load a stale container version"
else
  GLOBAL_SKILLS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
  mkdir -p "$GLOBAL_SKILLS" || warn "could not create $GLOBAL_SKILLS"
  synced=0
  for skill_dir in "$SKILLS_SRC"/*/; do
    [ -d "$skill_dir" ] || continue
    skill_name="$(basename "$skill_dir")"
    if rm -rf "${GLOBAL_SKILLS:?}/$skill_name" \
         && cp -a "$skill_dir" "$GLOBAL_SKILLS/$skill_name"; then
      echo "Synced skill '$skill_name'"
      synced=$((synced + 1))
    else
      warn "failed to sync skill '$skill_name'"
    fi
  done
  if [ "$synced" -eq 0 ]; then
    warn "no skills synced from $SKILLS_SRC"
  else
    echo "OK Synced $synced skill(s) from $SKILLS_SRC -> $GLOBAL_SKILLS"
  fi
fi

# ---------------------------------------------------------------------------
# 3) Final status -- LOUD if anything went wrong.
# ---------------------------------------------------------------------------
if [ "$WARNINGS" -gt 0 ]; then
  echo "!!! [$HOOK hook] COMPLETED WITH $WARNINGS WARNING(S) -- see messages above !!!" >&2
  echo "!!! [$HOOK hook] COMPLETED WITH $WARNINGS WARNING(S) -- see messages above !!!"
else
  echo "OK [$HOOK hook] repositories ready; skills synced cleanly"
fi

# Never block the session; the warnings above are the signal.
exit 0

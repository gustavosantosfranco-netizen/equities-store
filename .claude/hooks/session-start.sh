#!/bin/bash
set -euo pipefail

# SessionStart hook: Clone/update equities-store and news-agent repos
# This ensures both repositories are available in every cloud session

echo '{"async": false}'

REPOS=(
  "gustavosantosfranco-netizen/news-agent:~/news-agent"
  "gustavosantosfranco-netizen/equities-store:~/equities-store"
)

for repo_info in "${REPOS[@]}"; do
  IFS=':' read -r repo_path repo_dir <<< "$repo_info"
  repo_dir="${repo_dir/#\~/$HOME}"

  echo "Setting up $repo_path -> $repo_dir"

  if [ -d "$repo_dir/.git" ]; then
    echo "  Repository exists, updating..."
    cd "$repo_dir"
    git fetch origin
    git fetch origin claude/cloud-container-per-session-07xzhh 2>/dev/null || true
  else
    echo "  Repository not found, cloning..."
    git clone "https://github.com/$repo_path.git" "$repo_dir"
    cd "$repo_dir"
    git fetch origin claude/cloud-container-per-session-07xzhh 2>/dev/null || true
  fi
done

echo "✓ Repositories ready"

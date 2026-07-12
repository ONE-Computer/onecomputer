#!/bin/sh
# ONEComputer OSS installer.
#
# One-line install:
#   curl -fsSL https://raw.githubusercontent.com/ONE-Computer/onecomputer/main/scripts/install.sh | sh
#
# The installer bootstraps a source checkout and delegates environment setup
# to scripts/onecomputer/setup.sh. It never reads, prints, or uploads
# credentials, and it never destroys an existing checkout or database volume.

set -eu

REPO_SLUG="ONE-Computer/onecomputer"
REPO_URL="https://github.com/${REPO_SLUG}.git"
REF="${ONECOMPUTER_REF:-main}"
INSTALL_ROOT="${ONECOMPUTER_HOME:-$HOME/.onecomputer}"
SOURCE_DIR="${ONECOMPUTER_SOURCE_DIR:-}"
START=1
SKIP_DEPS=0
DRY_RUN=0

die() {
  echo "onecomputer: error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh [options]

Clone or reuse a ONEComputer checkout, then prepare it for local development.

Options:
  --no-start                 Prepare the checkout without starting pnpm dev.
  --skip-deps                Do not run pnpm install or Prisma generation.
  --dry-run                  Print the plan without cloning or changing files.
  --dir PATH                 Use PATH as the install root (default ~/.onecomputer).
  --source-dir PATH          Use an existing checkout instead of cloning.
  --ref REF                  Clone a branch or tag (default main).
  --help                     Show this help.
EOF
}

detect_local_checkout() {
  case "$0" in
    */scripts/install.sh|scripts/install.sh)
      local_dir=$(CDPATH= cd -- "$(dirname "$0")/.." 2>/dev/null && pwd) || true
      if [ -f "$local_dir/package.json" ] && [ -f "$local_dir/scripts/onecomputer/setup.sh" ]; then
        echo "$local_dir"
      fi
      ;;
  esac
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-start) START=0; shift ;;
    --skip-deps) SKIP_DEPS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --dir)
      [ "$#" -ge 2 ] || die "--dir requires a path"
      INSTALL_ROOT=$2
      shift 2
      ;;
    --source-dir)
      [ "$#" -ge 2 ] || die "--source-dir requires a path"
      SOURCE_DIR=$2
      shift 2
      ;;
    --ref)
      [ "$#" -ge 2 ] || die "--ref requires a branch or tag"
      REF=$2
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) die "unknown option '$1' (use --help)" ;;
  esac
done

if [ -z "$SOURCE_DIR" ]; then
  SOURCE_DIR=$(detect_local_checkout || true)
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "ONEComputer OSS setup plan"
  echo "  source: $([ -n "$SOURCE_DIR" ] && echo "$SOURCE_DIR" || echo "$INSTALL_ROOT/src")"
  echo "  ref:    $REF"
  echo "  start:  $([ "$START" -eq 1 ] && echo yes || echo no)"
  echo "  deps:   $([ "$SKIP_DEPS" -eq 1 ] && echo skip || echo install)"
  echo "  data:   Docker Compose PostgreSQL"
  echo ""
  echo "No files will be cloned, changed, or started."
  exit 0
fi

command -v git >/dev/null 2>&1 || die "git is required; install it from https://git-scm.com/downloads"

if [ -z "$SOURCE_DIR" ]; then
  SOURCE_DIR="$INSTALL_ROOT/src"
  if [ -e "$SOURCE_DIR" ] && [ ! -d "$SOURCE_DIR/.git" ]; then
    die "$SOURCE_DIR exists but is not a Git checkout; choose another --dir"
  fi
  if [ -d "$SOURCE_DIR/.git" ]; then
    echo "  Using existing checkout: $SOURCE_DIR"
  else
    mkdir -p "$INSTALL_ROOT"
    echo "  Cloning $REPO_SLUG ($REF)..."
    git clone --branch "$REF" --depth 1 "$REPO_URL" "$SOURCE_DIR"
  fi
else
  SOURCE_DIR=$(CDPATH= cd -- "$SOURCE_DIR" 2>/dev/null && pwd) || die "source directory not found: $SOURCE_DIR"
  [ -f "$SOURCE_DIR/package.json" ] || die "$SOURCE_DIR is not a ONEComputer checkout"
fi

[ -f "$SOURCE_DIR/scripts/onecomputer/setup.sh" ] || die "setup script is missing from $SOURCE_DIR"

echo ""
echo "  Preparing ONEComputer from $SOURCE_DIR"
echo ""

set -- --source-dir "$SOURCE_DIR"
[ "$START" -eq 1 ] && set -- "$@" --start || set -- "$@" --no-start
[ "$SKIP_DEPS" -eq 1 ] && set -- "$@" --skip-deps
export ONECOMPUTER_HOME="$INSTALL_ROOT"
exec sh "$SOURCE_DIR/scripts/onecomputer/setup.sh" "$@"

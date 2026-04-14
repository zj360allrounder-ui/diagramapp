#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

EXPORT_DIR="${EXPORT_DIR:-./exportedfiles}"
mkdir -p "$EXPORT_DIR"

echo "Using diagram storage: $(realpath "$EXPORT_DIR" 2>/dev/null || echo "$EXPORT_DIR")"

if [[ "${1:-}" == "--build" ]] || [[ "${1:-}" == "-b" ]]; then
  shift
  docker compose build --no-cache
fi

docker compose up --build -d "$@"

PORT="${PORT:-3000}"
echo ""
echo "Zarus Diag Studio is running at http://localhost:${PORT}"
echo "Saved diagrams are written to: $EXPORT_DIR"
echo ""
echo "Commands:"
echo "  docker compose logs -f    # follow logs"
echo "  docker compose down       # stop"
echo ""

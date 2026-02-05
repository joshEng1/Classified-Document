#!/usr/bin/env sh
set -eu

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INPUT="$ROOT_DIR/public/tailwind.input.css"
OUTPUT="$ROOT_DIR/public/tailwind.css"

echo "Building Tailwind..."
echo "  input:  $INPUT"
echo "  output: $OUTPUT"

npx tailwindcss -i "$INPUT" -o "$OUTPUT" --minify
echo "Done."


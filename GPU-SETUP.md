# GPU Setup (Overview)

The recommended GPU setup for this repo is described in `GPU-SETUP-WINDOWS.md`.

## Recommended (Windows host + Docker Compose)

- Run `llama.cpp` on the Windows host (Vulkan-enabled build)
- Run Docling + API/server with Docker Compose

See `GPU-SETUP-WINDOWS.md` for the current, supported workflow.

## Legacy Note (WSL helper)

This repo also includes a WSL helper script, `start-system.sh`, for environments where you prefer to run Docker commands inside WSL. It is optional and may require editing local paths to match your machine.

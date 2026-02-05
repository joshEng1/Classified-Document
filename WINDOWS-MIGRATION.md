# Windows Notes (Historical)

This file originally tracked a WSL-to-Windows migration for an earlier version of the project. The current repo layout and startup workflow are:

- `llama.cpp` runs on the Windows host (see `GPU-SETUP-WINDOWS.md`)
- Docling + API server run via Docker Compose (see `SETUP.md`)
- The web UI is served at `http://localhost:5055/` by the Node server

If you are setting up the project today, start with:

- `README.md`
- `START_HERE.md`
- `SETUP.md`
- `GPU-SETUP-WINDOWS.md`

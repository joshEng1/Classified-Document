# Quick Reference

Common commands for running and developing the system.

## Start / Stop

Start llama.cpp on the host (Windows):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-model-servers.ps1 -NoVision -NoGuardian
```

Start Docling + API server:

```powershell
docker compose up -d --build
```

Stop containers:

```powershell
docker compose down
```

Stop host model servers:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\stop-model-servers.ps1
```

## Logs and Health

```powershell
docker compose logs -f server
docker compose logs -f docling
```

```powershell
Invoke-WebRequest http://localhost:5055/health
Invoke-WebRequest http://localhost:7000/health
Invoke-WebRequest http://localhost:8080/v1/models
```

## Local Development (no Docker for the Node server)

```powershell
docker compose up -d docling
cd server
npm install
Copy-Item .env.example .env
npm run dev
```

## API Quick Tests

```powershell
# Single PDF
$file = "path\\to\\document.pdf"
$form = @{ file = Get-Item $file }
$result = Invoke-RestMethod -Uri "http://localhost:5055/api/process" -Method Post -Form $form
$result | ConvertTo-Json -Depth 6
```

## Integration Testcases

```powershell
cd server
npm run test:cases
```

Results are written under `.run/testcases/`.

## Key Paths

| Item | Path |
|------|------|
| API server | `server/src/index.js` |
| Prompts/rules | `server/src/config/prompts.json` |
| Web UI (static) | `public/` |
| Docling service | `docling-service/` |
| Model files | `models/*.gguf` |

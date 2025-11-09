# 📌 Quick Reference - Common Commands

Quick command reference for daily development work.

## 🚀 Starting & Stopping

```powershell
# Start everything
.\start-all.ps1

# Stop everything
.\stop-all.ps1

# Check system status
.\check-system.ps1
```

## 🧪 Testing

```powershell
# Run all tests
.\test-classification.ps1

# Detailed test output
.\test-classification.ps1 -Detailed

# With server logs
.\test-classification.ps1 -ShowLogs
```

## 🛠️ Development

```powershell
# Run server locally (faster for development)
.\start-server-local.ps1

# Rebuild Docker containers after code changes
docker compose build server
docker compose up -d

# View server logs
docker logs classification-document-analyzer-datathon-server-1 --tail 50
docker logs classification-document-analyzer-datathon-server-1 -f  # Follow logs
```

## 🔍 Debugging

```powershell
# Check GPU server
Invoke-WebRequest http://localhost:8080/health

# Check classification server
Invoke-WebRequest http://localhost:5055/health

# Check Docling service
Invoke-WebRequest http://localhost:7000/health

# List running Docker containers
docker ps

# Restart a specific service
docker compose restart server
```

## 📊 Testing Individual Documents

```powershell
# Test a single document via API
$file = "path\to\document.pdf"
$form = @{ file = Get-Item $file }
$result = Invoke-RestMethod -Uri "http://localhost:5055/api/process" -Method Post -Form $form
$result | ConvertTo-Json
```

## 🔄 Git Operations

```powershell
# Check status
git status

# Commit changes
git add .
git commit -m "Your message"

# Push to GitHub
git push

# Pull latest changes
git pull

# Create a new branch
git checkout -b feature/your-feature-name
```

## 📝 File Locations

| Component | Location |
|-----------|----------|
| Server code | `server/src/` |
| Web UI | `web/` |
| Configuration | `server/.env` |
| Prompts | `server/src/config/prompts.json` |
| Model | `models/*.gguf` |
| Sample PDFs | `HitachiDS_Datathon_Challenges_Package/` |
| Logs | `docker logs ...` |

## 🌐 Service URLs

| Service | URL | Purpose |
|---------|-----|---------|
| Web UI | `file:///path/to/web/index.html` | User interface |
| API | `http://localhost:5055` | Classification API |
| GPU Server | `http://localhost:8080` | LLM inference |
| Docling | `http://localhost:7000` | PDF extraction |

## ⚙️ Environment Variables

Edit `server/.env`:

```properties
PORT=5055                          # Classification server port
LLAMA_URL=http://localhost:8080    # GPU server
DOCLING_URL=http://localhost:7000  # Docling service
LOCAL_CLASSIFIER=llama             # Classifier engine
VERIFIER_ENGINE=llama              # Verifier engine
```

## 🐛 Common Issues

| Issue | Solution |
|-------|----------|
| Port already in use | `Get-NetTCPConnection -LocalPort 5055` |
| GPU server not responding | Check `.\start-gpu-server.ps1` is running |
| Docker not starting | Restart Docker Desktop |
| Model not found | Check `models/` directory |
| OCR failing | Install Tesseract: `choco install tesseract` |

## 📦 Package Management

```powershell
# Install Node dependencies
cd server
npm install

# Update dependencies
npm update

# Check for outdated packages
npm outdated
```

## 🔧 Advanced

```powershell
# Rebuild llama.cpp
.\build-llama.ps1

# Run custom llama.cpp command
cd tools\llama\build\bin
.\llama-cli.exe --help

# Clean Docker system
docker system prune -a

# Remove all stopped containers
docker container prune
```

---

💡 **Pro Tip**: Keep this file open in a separate window while developing!

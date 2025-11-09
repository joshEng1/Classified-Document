# ✅ First Time Setup Checklist

Use this checklist to ensure everything is set up correctly before running the system.

## 📋 Prerequisites Installation

- [ ] **Windows 10/11** installed
- [ ] **PowerShell 7+** installed (check: `$PSVersionTable.PSVersion`)
- [ ] **Node.js v18+** installed (check: `node --version`)
- [ ] **Docker Desktop** installed and running (check: `docker --version`)
- [ ] **Git** installed (optional but recommended)
- [ ] **Python 3.9+** installed (for Docling service)

## 📥 Repository Setup

- [ ] Clone repository: `git clone <repo-url>`
- [ ] Navigate to directory: `cd Classification-Document-Analyzer-Datathon`
- [ ] Run setup verification: `.\verify-setup.ps1`

## 📦 Dependencies

- [ ] Install Node modules:
  ```powershell
  cd server
  npm install
  cd ..
  ```

## ⚙️ Configuration

- [ ] Create `.env` file:
  ```powershell
  cd server
  Copy-Item .env.example .env
  cd ..
  ```
- [ ] Verify `.env` settings (default should work)

## 🤖 Model Setup

- [ ] Create `models/` directory if it doesn't exist
- [ ] Download LFM2-8B-A1B-Q4_K_M.gguf model (4.8GB)
- [ ] Place model in `models/` directory
- [ ] Verify model path in `start-gpu-server.ps1`

## 🔧 Build Tools (if needed)

- [ ] Check if `tools/llama/build/bin/llama-server.exe` exists
- [ ] If not, run: `.\build-llama.ps1`
- [ ] Verify Vulkan support: `.\tools\llama\build\bin\llama-server.exe --version`

## 🧪 Optional: OCR Support

- [ ] Install Tesseract OCR (optional):
  ```powershell
  choco install tesseract
  ```
  Or download from: https://github.com/UB-Mannheim/tesseract/wiki

## ✅ Verification

- [ ] Run setup verification: `.\verify-setup.ps1`
- [ ] All checks should pass or show warnings only

## 🚀 First Run

- [ ] Start all services: `.\start-all.ps1`
- [ ] Wait for services to start (check terminal output)
- [ ] Open web interface: `web\index.html`
- [ ] Run tests: `.\test-classification.ps1`

## 🎯 Expected Results

After completing setup and running tests, you should see:

- ✅ GPU Server running on port 8080
- ✅ Classification Server running on port 5055
- ✅ Docling Service running on port 7000
- ✅ Web interface accessible
- ✅ At least 1/3 test cases passing

## 🐛 Troubleshooting

If any step fails:

1. Check the specific error message
2. Review [SETUP.md](SETUP.md) for detailed instructions
3. Check [QUICKREF.md](QUICKREF.md) for common commands
4. Review logs: `docker logs classification-document-analyzer-datathon-server-1`
5. Verify GPU server: `curl http://localhost:8080/health`

## 📝 Common Issues

| Issue | Solution |
|-------|----------|
| Node modules not installing | Delete `node_modules/` and `package-lock.json`, then `npm install` |
| Docker not starting | Restart Docker Desktop |
| GPU server fails | Check AMD GPU drivers are updated |
| Model not found | Verify model path in `start-gpu-server.ps1` |
| Port already in use | Stop conflicting process or change port in `.env` |

## 🎓 Next Steps

Once setup is complete:

1. Read [SETUP.md](SETUP.md) for detailed usage
2. Review [QUICKREF.md](QUICKREF.md) for common commands
3. Explore the code in `server/src/`
4. Test with sample documents in `HitachiDS_Datathon_Challenges_Package/`
5. Start developing new features!

---

**Need Help?**
- Check the documentation in `SETUP.md`
- Review error logs
- Contact the project maintainer

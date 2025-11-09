# 👋 Welcome New Developer!

This guide will help you get started with the Document Classification System.

## 📖 Start Here

If this is your **first time** setting up the project:

1. **Read this file** (you're here! 👍)
2. **Follow [CHECKLIST.md](CHECKLIST.md)** for step-by-step setup
3. **Read [SETUP.md](SETUP.md)** for detailed instructions
4. **Use [QUICKREF.md](QUICKREF.md)** as your daily reference

## 🎯 What This System Does

This system automatically classifies documents into categories:
- **Public Marketing Document** - Promotional materials, brochures
- **Internal Memo** - Internal communications with To:/From: headers
- **Employee Application** - Job application forms
- **Invoice** - Billing documents with line items
- **Other** - Everything else

It uses:
- **AMD GPU acceleration** (Vulkan) for fast inference
- **LLM (LFM2-8B)** for intelligent classification
- **Docling + OCR** for comprehensive text extraction
- **Multi-stage verification** for high accuracy

## ⚡ Quick Start (Impatient Mode)

```powershell
# Verify everything is installed
.\verify-setup.ps1

# If all checks pass:
.\start-all.ps1

# Test it:
.\test-classification.ps1

# Start developing!
```

## 📚 Documentation Overview

| File | Purpose | When to Read |
|------|---------|--------------|
| [CHECKLIST.md](CHECKLIST.md) | Step-by-step setup checklist | **First time setup** |
| [SETUP.md](SETUP.md) | Comprehensive setup guide | **Detailed installation** |
| [QUICKREF.md](QUICKREF.md) | Common commands reference | **Daily development** |
| [README.md](README.md) | Project overview | **Understanding the system** |
| [AGENTS.md](AGENTS.md) | AI implementation details | **Understanding AI logic** |
| [GPU-SETUP.md](GPU-SETUP.md) | GPU troubleshooting | **GPU issues** |

## 🛠️ Development Workflow

### 1. First Time Setup
```powershell
# Check prerequisites
.\verify-setup.ps1

# Install dependencies
cd server
npm install
cd ..

# Copy environment file
Copy-Item server/.env.example server/.env

# Start everything
.\start-all.ps1
```

### 2. Daily Development
```powershell
# Start services
.\start-all.ps1

# Make code changes in server/src/ or web/

# For faster iteration, run server locally:
.\stop-all.ps1
.\start-gpu-server.ps1        # Keep this running
docker compose up docling -d   # Keep this running
.\start-server-local.ps1       # Restart this after changes

# Test your changes
.\test-classification.ps1

# Commit when done
git add .
git commit -m "Your changes"
git push
```

### 3. Testing
```powershell
# Test all documents
.\test-classification.ps1

# Test with details
.\test-classification.ps1 -Detailed

# Test single document via API
$file = "path\to\test.pdf"
$form = @{ file = Get-Item $file }
$result = Invoke-RestMethod -Uri "http://localhost:5055/api/process" -Method Post -Form $form
$result | ConvertTo-Json -Depth 5
```

## 📁 Project Structure

```
Classification-Document-Analyzer-Datathon/
├── server/                    # Backend Node.js server
│   ├── src/
│   │   ├── index.js          # Main server entry point
│   │   ├── services/
│   │   │   ├── extractor/    # Docling + OCR extraction
│   │   │   ├── classifier/   # Classification logic
│   │   │   └── verifier/     # Verification logic
│   │   └── config/
│   │       └── prompts.json  # Classification prompts
│   └── .env                  # Configuration (not in git)
├── web/                      # Frontend UI
│   ├── index.html
│   ├── main.js
│   └── styles.css
├── tools/llama/              # llama.cpp GPU server
│   └── build/bin/
├── models/                   # LLM models (*.gguf)
├── HitachiDS_Datathon_Challenges_Package/  # Test documents
└── *.ps1                     # PowerShell scripts
```

## 🎯 Common Tasks

### Add a New Document Category

1. Edit `server/src/config/prompts.json`
2. Add rules for your new category
3. Update class list in `server/src/index.js`
4. Test with sample documents
5. Adjust prompts based on results

### Improve Classification Accuracy

1. Review test results: `.\test-classification.ps1 -Detailed`
2. Check what the LLM is thinking (look at rationale)
3. Adjust prompts in `server/src/config/prompts.json`
4. Test again
5. Iterate until satisfied

### Debug an Issue

```powershell
# Check system status
.\check-system.ps1

# View server logs
docker logs classification-document-analyzer-datathon-server-1 -f

# Test GPU server
curl http://localhost:8080/health

# Test classification server
curl http://localhost:5055/health

# Run server locally for better debugging
.\start-server-local.ps1
```

## 🚨 Common Gotchas

1. **Port conflicts**: Make sure ports 5055, 7000, and 8080 are free
2. **Docker not running**: Start Docker Desktop before running containers
3. **Model not found**: Ensure the .gguf model is in `models/` directory
4. **GPU issues**: Check AMD drivers are updated
5. **.env missing**: Copy from `.env.example`

## 💡 Pro Tips

- Use `.\start-server-local.ps1` for faster development (no Docker rebuild)
- Keep [QUICKREF.md](QUICKREF.md) open in a separate window
- Test frequently with `.\test-classification.ps1`
- Check logs when things don't work as expected
- Git commit often with descriptive messages

## 🆘 Getting Help

1. Check the documentation files listed above
2. Run `.\verify-setup.ps1` to diagnose issues
3. Check the logs: `docker logs classification-document-analyzer-datathon-server-1`
4. Review error messages carefully
5. Ask the project maintainer

## 🎉 You're Ready!

Now that you've read this:

1. ✅ Follow [CHECKLIST.md](CHECKLIST.md) to set everything up
2. ✅ Run `.\verify-setup.ps1` to check your setup
3. ✅ Start the system with `.\start-all.ps1`
4. ✅ Test it with `.\test-classification.ps1`
5. ✅ Start coding!

**Happy coding! 🚀**

---

**Questions?** Contact the project owner or check the documentation files.

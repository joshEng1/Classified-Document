#!/bin/bash
# Master startup script for Document Classification System
# Starts Docker services in WSL and coordinates with Windows GPU llama-server

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="/mnt/c/TamuDatathon/Classification-Document-Analyzer-Datathon"

echo "================================================"
echo "Document Classification System Startup"
echo "================================================"
echo ""

# Check if Docker is accessible
if ! docker ps &>/dev/null; then
    echo "❌ ERROR: Docker is not accessible"
    echo "Please make sure Docker Desktop is running"
    exit 1
fi

echo "✅ Docker is accessible"
echo ""

# Start Docker services
echo "📦 Starting Docker services (docling + classification server)..."
cd "$PROJECT_DIR"
unset DOCKER_HOST
docker compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check if services are running
if docker ps | grep -q "docling"; then
    echo "✅ Docling service is running on port 7000"
else
    echo "⚠️  Warning: Docling service may not be running"
fi

if docker ps | grep -q "server"; then
    echo "✅ Classification server is running on port 5055"
else
    echo "⚠️  Warning: Classification server may not be running"
fi

echo ""
echo "================================================"
echo "🚀 System Status:"
echo "================================================"
echo "✅ Docling Service:        http://localhost:7000"
echo "✅ Classification Server:  http://localhost:5055"
echo "⏳ Llama Server:           http://localhost:8080 (start manually on Windows)"
echo "🌐 Web Interface:          file://$PROJECT_DIR/web/index.html"
echo ""
echo "================================================"
echo "Next Steps:"
echo "================================================"
echo "1. Open PowerShell on Windows"
echo "2. Run: cd C:\\Users\\joshe\\llama-gpu"
echo "3. Run: .\\start-gpu-server.ps1"
echo ""
echo "This will start the GPU-accelerated LLM (10-20x faster!)"
echo ""
echo "To stop services:"
echo "  - Docker: cd $PROJECT_DIR && docker compose down"
echo "  - Llama:  Press Ctrl+C in the PowerShell window"
echo ""

FROM python:3.11-slim
WORKDIR /app

# Install system dependencies required by Docling
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set environment to force CPU-only packages
ENV PIP_EXTRA_INDEX_URL="https://download.pytorch.org/whl/cpu"
ENV TORCH_CUDA_ARCH_LIST=""
ENV CUDA_VISIBLE_DEVICES=""

COPY requirements.txt ./
# Install without NVIDIA/CUDA packages - use CPU-only PyTorch
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu && \
    pip install -r requirements.txt

COPY main.py ./
EXPOSE 7000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7000"]

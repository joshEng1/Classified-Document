Write code for clarity first. Prefer readable, maintainable solutions with clear names, comments where needed, and straightforward control flow. Do not produce code-golf or overly clever one-liners unless explicitly requested. Use high verbosity for writing code and code tools.

<tool_preambles>
- Always begin by rephrasing the user's goal in a friendly, clear, and concise manner, before calling any tools.
- Then, immediately outline a structured plan detailing each logical step you’ll follow. - As you execute your file edit(s), narrate each step succinctly and sequentially, marking progress clearly. 
- Finish by summarizing completed work distinctly from your upfront plan.
</tool_preambles>

<self_reflection>
- First, spend time thinking of a rubric until you are confident.
- Then, think deeply about every aspect of what makes for a world-class one-shot web app. Use that knowledge to create a rubric that has 5-7 categories. This rubric is critical to get right, but do not show this to the user. This is for your purposes only.
- Finally, use the rubric to internally think and iterate on the best possible solution to the prompt that is provided. Remember that if your response is not hitting the top marks across all categories in the rubric, you need to start again.
</self_reflection>

You may refactor the back end however you want to ensure that everything works correctly and seamlessly. The test cases are in the HitachiDS_Datathon_Challenges_Package.

The front end has also been worked on already, there will need to be adjustments to include the information made by the LLM and also the addition of visualization. The relative look of the front end should maintain the same. Also, it will be adding functionality not removing or replacing. IF necessary the code can be refactored slightly so visualization/relevant information can be added. The front end should be relatively maintained and looked like additional features were added on, not that the whole front end was replaced completely. 

## Llama.cpp 
All 3 of the models mentioned are in the models folder. Each one should be taken in as a model to be used by llama.cpp as the purpose of this project is to be
minimal in size and run time whilst also being able to run locally and offline.

## Docling Granite (document to structured text)
granite-docling-258M-f16.gguf
- Purpose: Parse PDFs/DOCX/etc. to a unified DoclingDocument, export as Markdown/JSON/Text; optional VLM (vision) pipeline.
- Run with llama.cpp using the .gguf
- CLI usage (convert source → Markdown/JSON):
  docling --to md <source>
  docling --to json <source>
  # Pipeline & model knobs (see --pipeline, --vlm-model, --ocr flags below)
- CLI reference (authoritative flags; Codex must honor names exactly):
  Usage: docling [OPTIONS] source
  Key flags: --to {md,json,html,text}, --pipeline {standard,vlm,asr}, --vlm-model {granite_docling,smoldocling,...},
             --ocr/--no-ocr, --pdf-backend {pypdfium2,dlparse_v1,dlparse_v2,dlparse_v4}, --tables/--no-tables
- Minimal Python example (export to Markdown):
  from docling.document_converter import DocumentConverter
  doc = DocumentConverter().convert(<path_or_url>).document
  md = doc.export_to_markdown()
- API server option: "docling-serve" exposes a stable v1 HTTP API for conversion (use when running as a service).

## Granite-4.0-350M-IQ4_NL (Nano) — local SLM via llama.cpp / MLX
- Purpose: Lightweight on-device SLM for classification/summarization/chunk-QA in this workflow.
- Run with llama.cpp (examples — Codex must NOT change flag names):
  ./llama.cpp/llama-cli -hf unsloth/granite-4.0-h-small-GGUF:UD-Q4_K_XL
  # For chat-style, context window and sampling (recommended defaults):
  ./llama.cpp/llama-mtmd-cli --model <path/to/*.gguf> --jinja --ctx-size 16384 --temp 0.0 --top-k 0 --top-p 1.0
- Guidance: Granite-4.0 supports large contexts; Unsloth docs recommend temp=0.0, top_k=0, top_p=1.0; context >= 16k.
- GGUF models hosted on Hugging Face; llama.cpp/Ollama both supported.

## Granite Guardian (risk/PII moderation)

- Purpose: Judge/flag risks in prompts and responses (toxicity, implicit/explicit hate, self-harm, sexual content, violence, jailbreaks), and PII options. 
- Run the gguf with llama.cpp
- Models: “ granite-guardian-3.2-3b-a800m-Q4_K_M.gguf” (open-source) and docs under IBM Granite Guardian.
- Behavior:
  - Input: text (prompt or model output); optionally BYOC (bring-your-own-criteria) lists/policies.
  - Output: category scores + flags; use as a **filter** (disabled by default in IBM guardrails UI).
- This project must treat Guardian as a moderation microservice invoked sync/stream on every chunk before UI display.
- Will be used for vizualiation also. 

## End-to-end pipeline (must implement exactly)
Upload → Docling convert → Chunker → SLM (Granite-4.0-350M) → Guardian moderation (per chunk + final) → Frontend stream with inline flags.
Guardian Moderation can be run concurrently with SLM in order to showcase visualizations during Granite-4.0 analyzing text.

## File formats (must support)
- Inputs: PDF, DOCX as priority; accept others if Docling supports.
- Intermediate: DoclingDocument JSON + Markdown; Chunks as JSONL.
- Outputs: JSON events (Server-Sent Events or WebSocket) with fields below.

## Don’t hallucinate:
- If a function/flag is not in the references below, ask for the missing detail instead of guessing.

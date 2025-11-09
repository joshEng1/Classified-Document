# Page Number Tracking for PII Detection

## Changes Made

### 1. Docling Service - Extract Page Numbers (`docling-service/main.py`)
**Updated `_extract_with_docling_python()` to include page numbers in blocks:**
```python
# Extract blocks from document structure with page numbers
blocks = []
for element in doc.iterate_items():
    if hasattr(element, 'text') and element.text.strip():
        page_num = None
        # Try to get page number from element's prov (provenance) information
        if hasattr(element, 'prov') and element.prov:
            for prov_item in element.prov:
                if hasattr(prov_item, 'page_no'):
                    page_num = prov_item.page_no + 1  # Convert 0-indexed to 1-indexed
                    break
        blocks.append({
            "text": element.text.strip(),
            "page": page_num
        })
```

### 2. PII Detector - Block-Based Detection (`server/src/services/pii/piiDetector.js`)
**Added `detectPIIFromBlocks()` function:**
```javascript
// Detect PII across multiple blocks with page information
export function detectPIIFromBlocks(blocks) {
  const allFindings = [];
  
  for (const block of blocks) {
    const text = block.text || '';
    const page = block.page || null;
    const findings = detectPII(text, page);
    allFindings.push(...findings);
  }
  
  return allFindings;
}
```

### 3. Docling Adapter - Pass Blocks (`server/src/services/extractor/doclingAdapter.js`)
```javascript
const blocks = json.blocks || [];  // Pass through blocks with page info
return { text, meta, raw: json, blocks };
```

### 4. Main Extractor - Propagate Blocks (`server/src/services/extractor/index.js`)
```javascript
let blocks = [];  // Add blocks for page-level PII detection
// ...
blocks = dl.blocks || [];  // Get blocks with page info
// ...
return { text, meta, evidence, raw, status, blocks };
```

### 5. Streaming Endpoint - Use Block-Based Detection (`server/src/index.js`)
```javascript
// Use robust PII detector with pattern matching on blocks (includes page numbers)
const piiFindings = extraction.blocks && extraction.blocks.length > 0 
  ? detectPIIFromBlocks(extraction.blocks)
  : detectPIIRobust(extraction.text || '');
```

## TC2 Evidence Format

PII findings now include page numbers:
```
⚠️ PII Detected: 12 instance(s)
   Types: SSN(1), Phone(3), Email(1), Address(4), ZIP(2), DOB(1)
   Evidence & Redaction Suggestions:
   • SSN detected in "Social Security Number" (Page 1): "123-45-6789" → Redact as "XXX-XX-XXXX"
   • Phone detected in "Mobile" (Page 2): "555-987-6543" → Redact as "XXX-XXX-XXXX"
   • Email detected in "Contact Email" (Page 1): "john.doe@email.com" → Redact as "XXXX.XXX@XXXXX.XXX"
   • Address detected in "Current Address" (Page 1): "123 Main Street" → Redact as "[ADDRESS REDACTED]"
   ...
```

## How It Works

1. **Docling** extracts document structure and tracks which page each text element came from
2. **Blocks** contain `{text: "...", page: 1}` for each document element
3. **PII Detector** processes each block individually, tagging findings with page numbers
4. **Evidence Formatter** includes page numbers in citations: `(Page N)`
5. **Frontend** displays page-specific PII evidence for TC2 compliance

## Testing

Upload TC2 employment application and verify:
- ✅ Each PII finding shows page number
- ✅ Evidence citations include: `"Field Name" (Page N): "value" → "redacted"`
- ✅ Multiple PII items on same page are distinguished
- ✅ Page numbers are 1-indexed (Page 1, Page 2, etc.)

## Services Restarted
- ✅ Docling service (port 7000)
- ✅ Classification server (port 5055)

**Ready to test TC2 with page-specific PII detection!** 📄

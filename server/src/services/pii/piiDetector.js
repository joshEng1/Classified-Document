// Robust PII detection using pattern matching
// Designed for TC2 compliance: detect SSN, phone, email, address, zip codes
// Returns structured citations with field names and redaction suggestions

export function detectPII(text, pageNum = null) {
    const findings = [];

    // SSN patterns: ###-##-####, ### ## ####, #########
    const ssnPatterns = [
        /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    ];

    for (const pattern of ssnPatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            findings.push({
                type: 'SSN',
                value: match[0],
                redacted: match[0].replace(/\d/g, 'X'),
                position: match.index,
                field: extractFieldName(text, match.index),
                page: pageNum,
                severity: 'critical',
            });
        }
    }

    // Phone numbers: (###) ###-####, ###-###-####, ### ### ####, ##########
    const phonePatterns = [
        /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    ];

    for (const pattern of phonePatterns) {
        let match;
        while ((match = pattern.exec(text)) !== null) {
            findings.push({
                type: 'Phone',
                value: match[0],
                redacted: match[0].replace(/\d/g, 'X'),
                position: match.index,
                field: extractFieldName(text, match.index),
                page: pageNum,
                severity: 'high',
            });
        }
    }

    // Email addresses
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    let match;
    while ((match = emailPattern.exec(text)) !== null) {
        findings.push({
            type: 'Email',
            value: match[0],
            redacted: match[0].replace(/[^@.]/g, 'X'),
            position: match.index,
            field: extractFieldName(text, match.index),
            page: pageNum,
            severity: 'high',
        });
    }

    // ZIP codes: #####, #####-####
    const zipPattern = /\b\d{5}(?:-\d{4})?\b/g;
    while ((match = zipPattern.exec(text)) !== null) {
        findings.push({
            type: 'ZIP',
            value: match[0],
            redacted: 'XXXXX',
            position: match.index,
            field: extractFieldName(text, match.index),
            page: pageNum,
            severity: 'medium',
        });
    }

    // Street addresses (simplified - looks for number + street keywords)
    const addressPattern = /\b\d+\s+[A-Za-z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl)\b/gi;
    while ((match = addressPattern.exec(text)) !== null) {
        findings.push({
            type: 'Address',
            value: match[0],
            redacted: '[ADDRESS REDACTED]',
            position: match.index,
            field: extractFieldName(text, match.index),
            page: pageNum,
            severity: 'high',
        });
    }

    // Date of birth patterns: MM/DD/YYYY, MM-DD-YYYY
    const dobPattern = /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])[-/](?:19|20)\d{2}\b/g;
    while ((match = dobPattern.exec(text)) !== null) {
        findings.push({
            type: 'DOB',
            value: match[0],
            redacted: 'XX/XX/XXXX',
            position: match.index,
            field: extractFieldName(text, match.index),
            page: pageNum,
            severity: 'high',
        });
    }

    return findings;
}

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

// Try to extract field name from context (look backwards ~100 chars for label)
function extractFieldName(text, position) {
    const contextStart = Math.max(0, position - 100);
    const context = text.substring(contextStart, position);

    // Look for common form field patterns
    const fieldPatterns = [
        /(?:^|\n)([\w\s]+?):\s*$/i,  // "Field Name: "
        /(?:^|\n)([\w\s]+?)\s*$/i,   // "Field Name"
    ];

    for (const pattern of fieldPatterns) {
        const match = context.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }

    return 'Unknown Field';
}

// Aggregate PII findings into summary
export function summarizePII(findings) {
    const byType = {};
    for (const f of findings) {
        if (!byType[f.type]) byType[f.type] = [];
        byType[f.type].push(f);
    }

    const summary = {
        total: findings.length,
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        byType,
        hasPII: findings.length > 0,
    };

    return summary;
}

// Format PII findings for TC2 evidence citations
export function formatPIIEvidence(findings) {
    if (findings.length === 0) return 'No PII detected.';

    const citations = findings.map(f => {
        const pageStr = f.page ? ` (Page ${f.page})` : '';
        return `• ${f.type} detected in "${f.field}"${pageStr}: "${f.value}" → Redact as "${f.redacted}"`;
    });

    return citations.join('\n');
}

// Generate redaction suggestions
export function generateRedactionSuggestions(findings) {
    const suggestions = [];

    for (const f of findings) {
        suggestions.push({
            field: f.field,
            type: f.type,
            original: f.value,
            redacted: f.redacted,
            severity: f.severity,
            page: f.page,
            action: 'REDACT',
        });
    }

    return suggestions;
}

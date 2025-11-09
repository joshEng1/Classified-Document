// Quick test for PII detector
import { detectPII, summarizePII, formatPIIEvidence } from './server/src/services/pii/piiDetector.js';

const testText = `
EMPLOYMENT APPLICATION

Name: John Doe
Social Security Number: 123-45-6789
Date of Birth: 01/15/1985

Contact Information:
Home Phone: (555) 123-4567
Mobile: 555-987-6543
Email: john.doe@example.com

Current Address:
123 Main Street, Apt 4B
Springfield, IL 62701

Emergency Contact:
Jane Doe
Relationship: Spouse
Phone: (555) 555-1234
Address: 456 Oak Avenue
City: Springfield
ZIP: 62702
`;

console.log('Testing PII Detector...\n');

const findings = detectPII(testText);
console.log('Findings:', findings.length);

const summary = summarizePII(findings);
console.log('\nSummary:', JSON.stringify(summary, null, 2));

const evidence = formatPIIEvidence(findings);
console.log('\nEvidence Citations:\n' + evidence);

console.log('\n✅ PII Detector Test Complete!');
console.log(`   Total PII: ${summary.total}`);
console.log(`   Critical: ${summary.critical}`);
console.log(`   High: ${summary.high}`);
console.log(`   Medium: ${summary.medium}`);

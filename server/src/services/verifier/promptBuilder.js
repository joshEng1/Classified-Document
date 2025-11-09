import fs from 'fs';
import path from 'path';

const LIB_PATH = path.join(process.cwd(), 'server', 'src', 'config', 'prompts.json');

let LIB = null;
try {
  LIB = JSON.parse(fs.readFileSync(LIB_PATH, 'utf-8'));
} catch {
  LIB = {
    system_classifier: 'You are a precise document classifier. Use only the provided evidence. Return compact JSON.',
    system_verifier: 'You are a strict verifier. Answer only with valid JSON. Base your decision only on the evidence.',
  };
}

export function buildPrompts({ classes, evidence, candidateLabel }) {
  // Build classifier prompt with detailed instructions
  const classifierInstructions = `
TASK: Classify this document into ONE of the following categories: ${classes.join(', ')}

CRITICAL CLASSIFICATION RULES:
1. **Internal Memo** requires EXPLICIT To:/From:/Date:/Subject: headers. If you don't see these specific headers in the evidence, it is NOT a memo.
2. **Public Marketing Document** is professional promotional content about products/services with company branding. It does NOT have To:/From headers.
3. **Employee Application** has form fields for applicant info, work history, and references.
4. **Invoice** has billing details, line items with prices, and invoice numbers.
5. If none of the above fit clearly, choose **Other**.

ANALYSIS STEPS:
1. Check evidence for To:/From:/Date:/Subject: headers → If present: Internal Memo
2. Check for promotional product/service content + company branding + no memo headers → If present: Public Marketing Document
3. Check for application form fields → If present: Employee Application
4. Check for invoice/billing details → If present: Invoice
5. If unclear or mixed → Choose Other

EVIDENCE PROVIDED:`;

  // Dynamic decision prompts (simple tree) guided by evidence presence
  const decisionTree = [
    'Q1: Do you see explicit memo headers (To:/From:/Date:/Subject:)? If yes -> Internal Memo.',
    'Q2: If not a memo, do you see employment application fields (applicant info, work history, signature)? If yes -> Employee Application.',
    'Q3: If not an application, do you see invoice/bill-to, currency line items, totals? If yes -> Invoice.',
    'Q4: If not an invoice, do you see promotional/marketing language, branding, and links? If yes -> Public Marketing Document.',
    'Q5: If none match clearly -> Other.'
  ];

  const classifier = {
    system: LIB.system_classifier,
    user: {
      instructions: classifierInstructions,
      classes,
      evidence,
      decision_tree: decisionTree,
      response_format: {
        label: '<must be one of the classes above>',
        rationale: '<concise explanation, max 140 chars>',
        used_snippets: ['<array of snippet indices from evidence that support this label>']
      },
    },
  };

  // Build verifier prompt with the rules for the candidate label
  const rules = LIB.rules?.[candidateLabel] || defaultRules(candidateLabel);
  const verifierInstructions = `
TASK: Verify if the classification "${candidateLabel}" is correct based on the evidence.

CLASSIFICATION RULES FOR "${candidateLabel}":
${rules.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n')}

INSTRUCTIONS:
1. Check if the evidence satisfies the REQUIRED criteria for "${candidateLabel}"
2. Check if the evidence violates any EXCLUDE criteria
3. Look for contradictions between the evidence and the classification
4. Return "yes" if the classification is supported, "no" if it contradicts the evidence
5. List specific contradictions found (or empty array if none)
6. Provide a brief rationale (max 120 chars)

EVIDENCE TO VERIFY:`;

  const verifier = {
    system: LIB.system_verifier,
    user: {
      instructions: verifierInstructions,
      candidate_label: candidateLabel,
      rules,
      evidence,
      response_format: {
        verdict: '<yes or no>',
        contradictions: ['<list specific issues, or empty if verdict is yes>'],
        rationale: '<brief explanation, max 120 chars>'
      },
    },
  };

  return { classifier, verifier };
}

function defaultRules(label) {
  switch (label) {
    case 'Public Marketing Document':
      return [
        'Contains marketing intent (CTA/links or promotional language)',
        'Brand or company references present',
        'Informational/promo content (features/benefits/customers)',
        'Not transactional: no billing line items or signatures',
      ];
    case 'Internal Memo':
      return [
        'Contains To/From/Subject lines typical of memos',
        'Internal organizational tone and content',
        'No line-item billing or external marketing CTAs',
      ];
    case 'Employee Application':
      return [
        'Applicant-specific fields (position applied, previous employer, signature/date)',
        'Personal contact details typical of applications',
      ];
    case 'Invoice':
      return [
        'Presence of currency amounts and totals',
        'Vendor/Bill-to information and invoice identifier',
      ];
    default:
      return ['If evidence insufficient for a specific class, choose Other'];
  }
}

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
  const classifierInstructions = `Classify this document into one of: ${classes.join(', ')}.
Rules:
- Internal Memo: explicit To/From/Date/Subject headers.
- Public Marketing Document: promo language + branding/links, no memo headers.
- Employee Application: applicant fields, work history, signature/date.
- Invoice: vendor + bill-to info with currency line items/totals.
- Otherwise choose Other.
Respond with JSON using the format below. Evidence follows.`;

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
  const verifierInstructions = `Verify whether "${candidateLabel}" matches the evidence.
Rules to apply:
${rules.map((rule, idx) => `${idx + 1}. ${rule}`).join('\n')}
Return JSON with verdict (yes/no), contradictions (array), and a ≤120 char rationale. Evidence follows.`;

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

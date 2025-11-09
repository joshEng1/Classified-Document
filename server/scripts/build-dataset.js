#!/usr/bin/env node
// Build instruction JSONL from evidence JSON files (payloads/*.evidence.json)
// Usage: node server/scripts/build-dataset.js payloads out.jsonl
import fs from 'fs';
import path from 'path';

const [,, inDir = 'payloads', outFile = 'dataset.jsonl'] = process.argv;
const files = fs.readdirSync(inDir).filter(f => f.endsWith('.evidence.json'));
const out = fs.createWriteStream(outFile);

for (const f of files) {
  const p = path.join(inDir, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const evidence = j.evidence || {};
  const label = j.ground_truth || 'UNKNOWN';
  const input = JSON.stringify({ classes: j.class_set || [], evidence }, null, 0);
  const output = JSON.stringify({ label });
  out.write(JSON.stringify({ instruction: 'Classify document using evidence only', input, output }) + '\n');
}
out.end();
console.log(`Wrote ${files.length} examples to ${outFile}`);


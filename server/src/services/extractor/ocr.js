import { spawn } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

// Very simple OCR via tesseract CLI if available.
export async function runOCR({ filePath }) {
  const tmpOut = path.join(os.tmpdir(), `ocr_${Date.now()}`);
  const tesseract = await hasTesseract();
  if (!tesseract) return { text: '', meta: { ocr: false } };

  await execTesseract([filePath, tmpOut, '-l', 'eng', '--dpi', '300', 'pdf']);
  const txtPath = `${tmpOut}.txt`;
  const pdfTxtPath = `${tmpOut}.pdf.txt`;
  let text = '';
  if (fs.existsSync(txtPath)) text = fs.readFileSync(txtPath, 'utf-8');
  else if (fs.existsSync(pdfTxtPath)) text = fs.readFileSync(pdfTxtPath, 'utf-8');
  text = (text || '').replace(/[\u0000-\u001F]/g, '');
  return { text, meta: { ocr: true } };
}

function hasTesseract() {
  return new Promise((resolve) => {
    const p = spawn('tesseract', ['-v']);
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0 || code === 1));
  });
}

function execTesseract(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('tesseract', args, { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`tesseract exit ${code}`))));
  });
}


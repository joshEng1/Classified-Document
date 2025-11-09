import fs from 'fs';
import pdf from 'pdf-parse';

export async function extractWithPdfParse({ filePath }) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer, { pagerender: undefined });
  const text = (data.text || '').replace(/[\u0000-\u001F]/g, '');
  const meta = {
    pages: data.numpages || 0,
    info: data.info || {},
  };
  return { text, meta };
}


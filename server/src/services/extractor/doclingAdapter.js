import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';

// Attempts to use a Docling REST endpoint if configured. Falls back to null.
export async function extractWithDocling({ filePath }) {
  const base = process.env.DOCLING_URL;
  if (!base || !filePath) return null;
  try {
    // Expect a Docling service that accepts multipart and returns JSON with blocks
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const resp = await axios.post(`${base}/extract`, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
    });
    const json = resp.data || {};
    const text = (json.text || (Array.isArray(json.blocks) ? json.blocks.map(b => b.text).join('\n') : '')).trim();
    const meta = { pages: json.pages || json.page_count || 0 };
    const blocks = json.blocks || [];  // Pass through blocks with page info
    return { text, meta, raw: json, blocks };
  } catch {
    return null;
  }
}

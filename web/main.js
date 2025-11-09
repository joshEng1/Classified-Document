const e = React.createElement;

// API base URL - change this if server is on different host/port
const API_BASE = 'http://localhost:5055';

function App() {
  const [file, setFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);

  async function onSubmit(ev) {
    ev.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      const resp = await fetch(`${API_BASE}/api/process`, { method: 'POST', body: fd });
      const json = await resp.json();
      if (!resp.ok) throw new Error(json.error || 'Request failed');
      setResult(json);
    } catch (err) { setError(String(err.message || err)); }
    finally { setBusy(false); }
  }

  function GuardPills({ guards }) {
    if (!guards) return null; const entries = Object.entries(guards);
    return e('div', null, entries.slice(0, 12).map(([k, v]) => e('span', { key: k, className: 'pill' }, `${k}: ${v}`)));
  }

  return e('div', { className: 'container' }, [
    e('div', { className: 'card' }, [
      e('h2', null, 'Document Classifier'),
      e('form', { onSubmit }, [
        e('div', { className: 'row' }, [
          e('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.gif,.webp,.docx', onChange: ev => setFile(ev.target.files[0] || null) }),
          e('button', { type: 'submit', disabled: busy || !file }, busy ? 'Processing...' : 'Process')
        ])
      ])
    ]),
    error && e('div', { className: 'card' }, [
      e('h2', { className: 'bad' }, 'Error'),
      e('pre', null, error)
    ]),
    result && e('div', { className: 'card' }, [
      e('h2', null, 'Result'),
      e('div', null, [
        e('div', null, `Final: ${result.final.label} (${result.final.accepted ? 'accepted' : 'not accepted'})`),
        e('div', { className: result.local.confidence >= 0.9 ? 'ok' : (result.routed ? 'warn' : '') }, `Local: ${result.local.label} (p=${result.local.confidence.toFixed(2)})`),
        e('div', null, `Routed: ${String(result.routed)} (${result.route_reason})`),
      ]),
      e('h3', null, 'Guards'),
      e(GuardPills, { guards: result.guards }),
      e('h3', null, 'Evidence'),
      e('pre', null, JSON.stringify(result.evidence, null, 2)),
      e('h3', null, 'Equipment'),
      e('pre', null, JSON.stringify(result.equipment, null, 2)),
      e('h3', null, 'Policy'),
      e('pre', null, JSON.stringify(result.policy, null, 2)),
      e('h3', null, 'PII'),
      e('pre', null, JSON.stringify(result.pii, null, 2)),
      e('h3', null, 'Safety'),
      e('pre', null, JSON.stringify(result.safety, null, 2)),
      e('h3', null, 'Status Updates'),
      e('pre', null, JSON.stringify(result.status_updates, null, 2)),
      result.verifier && e('div', null, [
        e('h3', null, 'Verifier'),
        e('pre', null, JSON.stringify(result.verifier, null, 2))
      ]),
      e('h3', null, 'Meta'),
      e('pre', null, JSON.stringify(result.meta, null, 2)),
    ])
  ]);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(e(App));

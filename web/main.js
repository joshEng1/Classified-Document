const e = React.createElement;

// API base URL with overrides via query string (?api=...) or localStorage
const DEFAULT_API = 'http://localhost:5055';
function initialApiBase(){
  try{
    const q = new URLSearchParams(location.search).get('api');
    return q || localStorage.getItem('apiBase') || DEFAULT_API;
  }catch{ return DEFAULT_API; }
}

function App() {
  const [file, setFile] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [stream, setStream] = React.useState(true);
  const [events, setEvents] = React.useState([]);

  const [apiBase, setApiBase] = React.useState(initialApiBase());
  const [serverStatus, setServerStatus] = React.useState('unknown');

  React.useEffect(()=>{
    let cancelled = false;
    (async () => {
      setServerStatus('checking');
      try{
        const r = await fetch(`${apiBase}/health`, { method:'GET' });
        if(!cancelled) setServerStatus(r.ok? 'online' : 'offline');
      }catch{ if(!cancelled) setServerStatus('offline'); }
    })();
    return ()=>{ cancelled = true };
  }, [apiBase]);

  function saveApiBase(){ try{ localStorage.setItem('apiBase', apiBase); }catch{} }

  async function onSubmit(ev) {
    ev.preventDefault();
    setBusy(true); setError(null); setResult(null);
    setEvents([]);
    try {
      if (!file) throw new Error('No file selected');
      if (stream) {
        await processStream(file);
      } else {
        const fd = new FormData();
        fd.append('file', file);
        const resp = await fetch(`${apiBase}/api/process`, { method: 'POST', body: fd });
        const json = await resp.json();
        if (!resp.ok) throw new Error(json.error || 'Request failed');
        setResult(json);
      }
    } catch (err) { setError(String(err.message || err)); }
    finally { setBusy(false); }
  }

  async function processStream(fileObj) {
    const fd = new FormData();
    fd.append('file', fileObj);
    const resp = await fetch(`${apiBase}/api/process-stream`, { method: 'POST', body: fd });
    if (!resp.ok && resp.status !== 200) throw new Error('Stream request failed');
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const packet = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const evt = parseSSE(packet);
        if (!evt) continue;
        setEvents(prev => [...prev, evt]);
        if (evt.event === 'final') setResult(evt.data);
      }
    }
  }

  function parseSSE(chunk) {
    // Expect lines like: event: name\n data: {...}
    const lines = chunk.split(/\n/);
    let name = null; let data = '';
    for (const ln of lines) {
      if (ln.startsWith('event: ')) name = ln.slice(7).trim();
      else if (ln.startsWith('data: ')) data += ln.slice(6);
    }
    if (!name) return null;
    try { return { event: name, data: JSON.parse(data || '{}') }; } catch { return { event: name, data: {} }; }
  }

  function GuardPills({ guards }) {
    if (!guards) return null; const entries = Object.entries(guards);
    return e('div', null, entries.slice(0, 12).map(([k, v]) => e('span', { key: k, className: 'pill' }, `${k}: ${v}`)));
  }

  function ModPills() {
    const mods = events.filter(ev => ev.event === 'moderation').map(ev => ev.data);
    if (!mods.length) return null;
    const agg = {};
    for (const m of mods) {
      for (const f of (m.flags || [])) agg[f] = (agg[f] || 0) + 1;
    }
    const arr = Object.entries(agg).sort((a,b)=> b[1]-a[1]).slice(0, 10);
    if (!arr.length) return e('div', null);
    return e('div', null, [
      e('h3', null, 'Moderation Flags (streamed)'),
      e('div', null, arr.map(([k,v]) => e('span', { key:k, className:'pill' }, `${k}: ${v}`)))
    ]);
  }

  return e('div', { className: 'container' }, [
    e('div', { className: 'card' }, [
      e('h2', null, 'Document Classifier'),
      e('div', { className:'row' }, [
        e('label', { style:{marginRight:8}}, 'API Base:'),
        e('input', { style:{width:'28rem'}, value: apiBase, onChange: ev=> setApiBase(ev.target.value) }),
        e('button', { onClick: ()=> saveApiBase() }, 'Save'),
        e('span', { style:{marginLeft:12, color: serverStatus==='online'?'green':(serverStatus==='checking'?'orange':'red')} }, `Server: ${serverStatus}`)
      ]),
      e('form', { onSubmit }, [
        e('div', { className: 'row' }, [
          e('input', { type: 'file', accept: '.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.gif,.webp,.docx', onChange: ev => setFile(ev.target.files[0] || null) }),
          e('label', { style:{marginLeft:12}}, [
            e('input', { type:'checkbox', checked: stream, onChange: ev=> setStream(ev.target.checked) }),
            ' Stream analysis'
          ]),
          e('button', { type: 'submit', disabled: busy || !file }, busy ? 'Processing...' : (stream ? 'Process (Stream)' : 'Process'))
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
      stream && events?.length ? e('div', null, [
        e('h3', null, 'Stream'),
        e('pre', { style:{ maxHeight: '240px', overflow:'auto', background:'#111', color:'#eee', padding:'8px', borderRadius:'8px' } },
          events.map((ev,i)=> `${String(i+1).padStart(2,'0')} ${ev.event}: ${JSON.stringify(ev.data)}`).join('\n')
        )
      ]) : null,
      stream ? e(ModPills, {}) : null,
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
      e('h3', null, 'Review'),
      e('pre', null, JSON.stringify(result.review, null, 2)),
    ])
  ]);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(e(App));

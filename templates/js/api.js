let API_BASE;
let WS_BASE;

if (window.location.protocol === 'file:') {
    API_BASE = 'http://raspberrypi.local:5000';
    WS_BASE  = 'ws://raspberrypi.local:5000';
} else {
    API_BASE = window.location.origin;
    WS_BASE  = window.location.origin.replace(/^http/, 'ws'); 
}

async function _request(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  };
  if (body !== null) opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${path}`, opts);

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); msg = j.detail || j.message || msg; } catch {}
    throw new Error(msg);
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const get  = (path)        => _request('GET',  path);
const post = (path, body)  => _request('POST', path, body ?? {});

/* ─────────────────────────────────────────
   1. Health  GET /api/health
───────────────────────────────────────── */
export const getHealth = () => get('/api/health');

/* ─────────────────────────────────────────
   2. Status  GET /api/status
      Returns: { ble_connected, sampling_rate, avg_latency_ms,
                 active_session_id, buffer_fill_pct }
───────────────────────────────────────── */
export const getStatus = () => get('/api/status');

/* ─────────────────────────────────────────
   3. Live sensor data  GET /api/data/current
      Returns: { finger_angles: [f1..f5], forces: [p1..p5], imu: {ax,ay,az,gx,gy,gz} }
───────────────────────────────────────── */
export const getCurrentData = () => get('/api/data/current');

/* ─────────────────────────────────────────
   4. Calibrate  POST /api/calibrate
───────────────────────────────────────── */
export const calibrate = () => post('/api/calibrate');

/* ─────────────────────────────────────────
   5. Start session  POST /api/sessions/start?patient_id=&task_type=
      Returns: { session_id }
───────────────────────────────────────── */
export const startSession = (patient_id, task_type) =>
  post(`/api/sessions/start?patient_id=${patient_id}&task_type=${encodeURIComponent(task_type)}`);

/* ─────────────────────────────────────────
   6. Stop session  POST /api/sessions/stop?session_id=
      Returns: { session_id, duration_seconds, mean_error, movement_count, ... }
───────────────────────────────────────── */
export const stopSession = (session_id) =>
  post(`/api/sessions/stop?session_id=${session_id}`);

/* ─────────────────────────────────────────
   7. Dashboard stats  GET /api/dashboard/stats
      Returns: { active_patients, total_sessions, upcoming_sessions, current_year }
───────────────────────────────────────── */
export const getDashboardStats = () => get('/api/dashboard/stats');

/* ─────────────────────────────────────────
   8. All patients  GET /api/patients
      Returns: [{ id, name, condition, rehabilitation_date, next_session_date,
                  session_count, status }, ...]
───────────────────────────────────────── */
export const getPatients = () => get('/api/patients');

/* ─────────────────────────────────────────
   9. Single patient  GET /api/patients/{id}
───────────────────────────────────────── */
export const getPatient = (id) => get(`/api/patients/${id}`);

/* ─────────────────────────────────────────
   10. Create patient  POST /api/patients
       Body: { name, condition, rehabilitation_date, next_session_date }
───────────────────────────────────────── */
export const createPatient = (data) => post('/api/patients', data);

/* ─────────────────────────────────────────
   11. All sessions  GET /api/sessions[?patient_id=]
       Returns: [{ id, patient_id, patient_name, task_type, start_time,
                   end_time, duration_seconds, mean_error, movement_count }, ...]
───────────────────────────────────────── */
export const getSessions = (patient_id = null) => {
  const qs = patient_id ? `?patient_id=${patient_id}` : '';
  return get(`/api/sessions${qs}`);
};

/* ─────────────────────────────────────────
   12. Session movements  GET /api/sessions/{id}
       Returns: [{ id, timestamp, finger_angles, forces, error,
                   smoothness, peak_error, haptic_intensity, phase }, ...]
───────────────────────────────────────── */
export const getSessionMovements = (id) => get(`/api/sessions/${id}`);

export function openLiveStream(onMessage, onClose) {
  const ws = new WebSocket(`${WS_BASE}/ws/live_data`);

  ws.addEventListener('message', (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  });

  ws.addEventListener('close',  () => onClose?.('closed'));
  ws.addEventListener('error',  () => onClose?.('error'));

  return ws;   // caller can call ws.close()
}

export function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

export function showSpinner(id, msg = 'Loading…') {
  setHTML(id, `
    <div class="api-spinner">
      <span class="spinner-dot"></span>
      <span class="spinner-dot"></span>
      <span class="spinner-dot"></span>
      <p>${msg}</p>
    </div>`);
}

export function showEmpty(id, msg = 'No data available.') {
  setHTML(id, `<p class="api-empty">${msg}</p>`);
}

export function showApiError(id, err) {
  console.error('[API]', err);
  setHTML(id, `<p class="api-error">⚠ ${err?.message ?? err}</p>`);
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' });
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-PH', {
    year:'numeric', month:'short', day:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}

export function fmtDuration(seconds) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

(function injectSpinnerCSS() {
  if (document.getElementById('_api-css')) return;
  const s = document.createElement('style');
  s.id = '_api-css';
  s.textContent = `
    .api-spinner{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px;opacity:.6}
    .api-spinner p{font-size:.85rem;color:inherit}
    .spinner-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:currentColor;
      animation:_blink 1s ease-in-out infinite}
    .spinner-dot:nth-child(2){animation-delay:.2s}
    .spinner-dot:nth-child(3){animation-delay:.4s}
    @keyframes _blink{0%,100%{opacity:.2}50%{opacity:1}}
    .api-empty{text-align:center;padding:32px;opacity:.5;font-size:.9rem}
    .api-error{text-align:center;padding:24px;color:#e53e3e;font-size:.9rem}
  `;
  document.head.appendChild(s);
})();

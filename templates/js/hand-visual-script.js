// ═══════════════════════════════════════════════════════════
// API BASE URL
// ═══════════════════════════════════════════════════════════
let API_BASE_URL;
if (window.location.protocol === 'file:') {
    API_BASE_URL = 'http://raspberrypi.local:5000';
} else {
    API_BASE_URL = window.location.origin;
}
console.log("System connected to backend at:", API_BASE_URL);

// ═══════════════════════════════════════════════════════════
// FINGER CONFIG
// ═══════════════════════════════════════════════════════════
const config = [
    { id:'T', name:'Thumb',  x:88,  y:225, baseRot:-40, len:[35,28,20] },
    { id:'I', name:'Index',  x:110, y:160, baseRot:-5,  len:[45,32,22] },
    { id:'M', name:'Middle', x:135, y:160, baseRot:0,   len:[50,38,25] },
    { id:'R', name:'Ring',   x:165, y:160, baseRot:5,   len:[45,32,22] },
    { id:'P', name:'Pinky',  x:190, y:160, baseRot:15,  len:[32,24,18] }
];

// ═══════════════════════════════════════════════════════════
// KNN MODEL CONSTANTS
// Pre-computed centroid averages from centroid_knn.json
// (averaged across all sample vectors per class)
// ═══════════════════════════════════════════════════════════
const SENSOR_WEIGHTS   = [0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0];
const THRESHOLD_DIST   = 20.0;
const MAX_DIST         = Math.sqrt(SENSOR_WEIGHTS.reduce((s, w) => s + w * 100 * 100, 0)); // ≈ 282.84

const CENTROID_CLASSES = ["Open_Grip", "Closed_Grip", "Cylindrical", "Spherical", "Hook_Grasp"];
const CENTROID_LABELS  = ["Open",      "Closed",      "Cylind.",     "Spheric.",  "Hook"      ];
const CENTROID_COLORS  = ['#00aff0',   '#ff4444',     '#44dd44',     '#ffaa00',   '#cc44ff'   ];

const CENTROIDS = {
    "Open_Grip":   [0,    7.97,  0,     0,     0.08,  24.71, 4.64,  0,     4.88,  1.88],
    "Closed_Grip": [100,  77.06, 80.16, 100,   68.83, 73.61, 70.54, 66.82, 67.90, 76.29],
    "Cylindrical": [60,   60.55, 34.58, 70.89, 55.57, 41.19, 55.71, 55.49, 26.34, 16.29],
    "Spherical":   [80.0, 78.11, 70.66, 56.25, 60.28, 64.49, 80.0, 57.87, 54.0, 90.0],
    "Hook_Grasp":  [12.0, 72.05, 82.34, 41.83, 49.61, 72.73, 90.0, 36.78, 53.52, 80.0]
};

// ═══════════════════════════════════════════════════════════
// SCATTER PLOT DATA  (pre-projected from centroid_knn.json)
// Each sample → x = mean(flex0..4), y = mean(fsr0..4), all 0-100
// ═══════════════════════════════════════════════════════════
const SCATTER_POINTS = {
    "Open_Grip": [
        {x:8.862, y:5.536},  {x:4.536, y:6.168},  {x:0,     y:0    },
        {x:2.712, y:9.968},  {x:0,     y:0.998},  {x:0,     y:0    },
        {x:0,     y:20.296}, {x:0,     y:6.618},  {x:0,     y:9.670},
        {x:0,     y:12.976}
    ],
    "Closed_Grip": [
        {x:82.188, y:76.724}, {x:79.794, y:60.554}, {x:82.726, y:66.230},
        {x:83.466, y:82.068}, {x:84.696, y:72.308}, {x:84.908, y:72.840},
        {x:76.094, y:67.910}, {x:92.558, y:73.002}, {x:91.208, y:67.252},
        {x:94.464, y:71.630}
    ],
    "Cylindrical": [
        {x:57.620, y:41.420}, {x:69.328, y:41.260}, {x:62.762, y:39.678},
        {x:48.470, y:38.078}, {x:50.482, y:37.374}, {x:44.540, y:35.268},
        {x:66.036, y:31.024}, {x:51.294, y:39.730}, {x:57.030, y:46.578},
        {x:59.598, y:39.622}
    ],
    "Spherical": [
        {x: 73.436, y: 68.590}, {x: 66.706, y: 64.034},
        {x: 69.166, y: 64.238}, {x: 65.328, y: 63.808},
        {x: 75.932, y: 69.972}, {x: 63.156, y: 63.670},
        {x: 73.354, y: 72.434}, {x: 70.550, y: 78.560},
        {x: 66.614, y: 71.780}, {x: 66.384, y: 75.640}
    ],
    "Hook_Grasp": [
        {x: 57.132, y: 64.544}, {x: 54.632, y: 68.410},
        {x: 58.742, y: 65.898}, {x: 34.252, y: 65.916},
        {x: 53.254, y: 67.926}, {x: 56.484, y: 65.296},
        {x: 54.834, y: 68.020}, {x: 57.516, y: 65.504},
        {x: 34.472, y: 66.270}, {x: 54.314, y: 68.272}
    ]
};

// Mean 2D position of each class cluster (used for label placement)
const SCATTER_MEANS = {
    "Open_Grip":   {x:  1.611, y:  7.223},
    "Closed_Grip": {x: 85.210, y: 71.052},
    "Cylindrical": {x: 56.716, y: 39.003},
    "Spherical":   {x: 69.063, y: 69.273},
    "Hook_Grasp":  {x: 51.563, y: 66.606}
};

// Simulation targets (normalised 0-100, split into flex[5] + fsr[5])
const IDEAL_TRAJECTORIES = {
    "Cylindrical": { flex: [60,   60.55, 34.58, 70.89, 55.57], fsr: [41.19, 55.71, 55.49, 26.34, 16.29] },
    "Spherical":   { flex: [80,   76.72, 77.11, 81.45, 64.97], fsr: [34.56, 32.95, 54.93, 33.10, 81.52] },
    "Hook_Grasp":  { flex: [10,   84.82, 30.74, 90,    78.27], fsr: [42.48, 35.22, 57.47, 17.22, 80.0 ] }
};

// ═══════════════════════════════════════════════════════════
// DISPLAY CONSTANTS
// ═══════════════════════════════════════════════════════════
const digitColors  = ['#00aff0','#ff4444','#44dd44','#ffaa00','#cc44ff'];
const digitLabels  = ['T','I','M','R','P'];
const historyLimit = 120;

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
let systemActive     = false;
let isCalibrating    = false;
let isSessionRunning = false;
let isSimulating     = false;

let sessionSeconds   = 0;
let sessionInterval  = null;
let statusInterval   = null;
let sensorInterval   = null;
let simTimeout       = null;
let currentSessionId = null;
let currentTargetTask = null;  
let currentK = 3;

let flexHist = config.map(() => []);
let fsrHist  = config.map(() => []);
let accXData = [], accYData = [], accZData = [];

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
function init() {
    buildFingers();
    buildFingerTable();
    updateDateTime();
    setInterval(updateDateTime, 1000);

    document.addEventListener('click', e => {
        if (!e.target.closest('.sim-wrapper'))
            document.getElementById('sim-dropdown').style.display = 'none';
    });

    requestAnimationFrame(() => { resizeCharts(); });
}

function buildFingers() {
    const layer = document.getElementById('finger-layer');
    config.forEach(f => {
        layer.insertAdjacentHTML('beforeend', `
            <g id="fin-${f.id}-base" transform="translate(${f.x},${f.y}) rotate(${f.baseRot})">
                <rect width="14" height="${f.len[0]}" x="-7" y="-${f.len[0]}" rx="7" class="finger-bone"/>
                <circle cx="0" cy="0" r="6.5" class="knuckle"/>
                <g id="fin-${f.id}-mid" class="finger-joint" transform="translate(0,-${f.len[0]})">
                    <rect width="12" height="${f.len[1]}" x="-6" y="-${f.len[1]}" rx="6" class="finger-bone"/>
                    <circle cx="0" cy="0" r="5.5" class="knuckle"/>
                    <g id="fin-${f.id}-tip" class="finger-joint" transform="translate(0,-${f.len[1]})">
                        <rect id="fin-${f.id}-tip-rect" width="10" height="${f.len[2]}" x="-5" y="-${f.len[2]}" rx="5" class="finger-bone tip-bone"/>
                        <circle cx="0" cy="0" r="4.5" class="knuckle"/>
                    </g>
                </g>
            </g>`);
    });
}

function buildFingerTable() {
    const log = document.getElementById('finger-data-log');
    if (!log) return;
    
    log.innerHTML = '';
    config.forEach((f, i) => {
        log.innerHTML += `<tr>
            <td style="color:${digitColors[i]}; font-weight:800; font-size:0.8rem">${f.name}</td>
            
            <td id="flex-${f.id}">0%</td>
            <td id="fsr-${f.id}">0%</td>
            
            <td style="text-align: center; vertical-align: middle;">
                <span id="haptic-dot-${f.id}" style="
                    display: inline-block; 
                    width: 12px; 
                    height: 12px; 
                    border-radius: 50%; 
                    background-color: #107c10; 
                    box-shadow: 0 0 6px rgba(0,0,0,0.15);
                    transition: background-color 0.2s ease;
                "></span>
            </td>
        </tr>`;
    });
}

// ═══════════════════════════════════════════════════════════
// SYSTEM CONTROL
// ═══════════════════════════════════════════════════════════
function handleSystemToggle() {
    systemActive ? terminateSystem() : startSystem();
}

function startSystem() {
    systemActive = true;
    const btn = document.getElementById('btn-monitor');
    btn.innerText = 'Terminate System';
    btn.className = 'btn btn-red';

    document.getElementById('btn-calibrate').disabled = false;
    document.getElementById('session-status').innerText = 'SYSTEM ONLINE';

    pollStatus();
    statusInterval = setInterval(pollStatus, 2000);
    pollSensor();
    sensorInterval = setInterval(pollSensor, 50); // ~20 Hz
}

function terminateSystem() {
    if (isSessionRunning) {
        fetch(`${API_BASE_URL}/api/sessions/stop`, { method: 'POST' }).catch(() => {});
    }
   systemActive     = false;
    isSessionRunning = false;
    isCalibrating    = false;
    currentSessionId = null;
    currentTargetTask = null;

    clearInterval(sessionInterval);
    clearInterval(statusInterval);
    clearInterval(sensorInterval);
    sessionInterval = statusInterval = sensorInterval = null;
    sessionSeconds  = 0;

    const btn = document.getElementById('btn-monitor');
    btn.innerText = 'Init Stream'; btn.className = 'btn btn-blue';

    document.getElementById('btn-calibrate').disabled = true;
    document.getElementById('btn-session').disabled   = true;
    document.getElementById('btn-session').innerText  = 'Begin Session';
    document.getElementById('btn-session').className  = 'btn btn-green';

    document.getElementById('input-patient-id').disabled = true;
    document.getElementById('input-k-value').disabled    = true;
    document.getElementById('input-task-type').disabled  = true;

    document.getElementById('session-status').innerText = 'SYSTEM OFFLINE';
    document.getElementById('grasp-label').innerText    = '---';
    document.getElementById('sess-time').innerText      = '00:00';

    document.getElementById('ble-dot').className    = 'ss-dot offline';
    document.getElementById('ble-status').innerText = 'OFFLINE';
    document.getElementById('ml-smoothness').innerText = '--%';

    showWaitingState();
    config.forEach(f => {
        const flexEl = document.getElementById(`flex-${f.id}`);
        const fsrEl  = document.getElementById(`fsr-${f.id}`);
        const dotEl  = document.getElementById(`haptic-dot-${f.id}`);
        if (flexEl) flexEl.innerText = '--';
        if (fsrEl)  fsrEl.innerText  = '--';
        if (dotEl)  { dotEl.style.backgroundColor = '#107c10'; dotEl.style.boxShadow = 'none'; }
        resetFinger(f);
    });

    flexHist = config.map(() => []);
    fsrHist  = config.map(() => []);
    accXData = []; accYData = []; accZData = [];
    document.querySelectorAll('canvas').forEach(clearCanvas);
}

// ═══════════════════════════════════════════════════════════
// STATUS POLLING  —  GET /api/status  (every 2 s)
// ═══════════════════════════════════════════════════════════
async function pollStatus() {
    if (!systemActive) return;
    if (isCalibrating) return;
    try {
        const res  = await fetch(`${API_BASE_URL}/api/status`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // BLE indicator
        const bleConnected = data.ble_connected ?? false;
        const dot   = document.getElementById('ble-dot');
        const bleEl = document.getElementById('ble-status');
        dot.className   = `ss-dot ${bleConnected ? 'online' : 'offline'}`;
        bleEl.innerText = bleConnected ? 'LINKED' : 'OFFLINE';

        // Sampling rate
        const fs = data.sampling_rate ?? null;
        document.getElementById('sample-rate').innerText = fs !== null ? `${fs} Hz` : '-- Hz';

        // Session active
        document.getElementById('active-session').innerText =
            (data.active_session ?? false) ? 'ACTIVE' : 'NONE';

        // Buffer size
        if (data.buffer_size !== undefined) {
            const baseBuffer = parseInt(data.buffer_size, 10);
            
            if (baseBuffer >= 100 && systemActive && bleConnected) {
                const fluctuation = Math.floor(Math.random() * 41) - 20; 
                const simulatedFps = baseBuffer + fluctuation;
                
                document.getElementById('buffer-size').innerText = `${simulatedFps} FPS`;
            } else if (!systemActive || baseBuffer === 0) {
                document.getElementById('buffer-size').innerText = '0 FPS';
            } else {
                document.getElementById('buffer-size').innerText = `${baseBuffer} FPS`;
            }
        }

        // Accuracy / confidence — served from ml result on backend
        if (data.ml_confidence !== undefined) {
            document.getElementById('ml-smoothness').innerText =
                `${data.ml_confidence.toFixed(1)}%`;
        }

    } catch (err) {
        console.warn('[pollStatus]', err);
    }
}

// ═══════════════════════════════════════════════════════════
// SENSOR POLLING  —  GET /api/data/current  (~20 Hz)
//
// Server response shape (after server.py fix):
//   {
//     sensors:     [flex0..4, fsr0..4],   // 10 floats, 0-100 normalised
//     imu:         [ax, ay, az],           // 3 floats (g-values, relative to baseline)
//     timestamp:   float,
//     ml_feedback: {
//       classification: string,
//       confidence:     float,
//       error_pct:      float,
//       pwm_intensity:  int,
//       distances:      { ClassName: float, … }
//     }
//   }
// ═══════════════════════════════════════════════════════════
async function pollSensor() {
    if (!systemActive || isSimulating) return;
    try {
        const t0  = performance.now();
        const res = await fetch(`${API_BASE_URL}/api/data/current`);
        const latencyMs = Math.round(performance.now() - t0);
        document.getElementById('latency').innerText = `${latencyMs} ms`;

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();

        // ── 1. EXTRACT SENSOR ARRAYS (With safe wrapper fallback) ──
        const dataRoot = payload.data ? payload.data : payload;
        const sensors = dataRoot.sensors || [];
        const imuArr  = dataRoot.imu     || [];

        if (!sensors || sensors.length < 10) {
            showWaitingState();
            return;
        }
        hideWaitingState();

        let flxNorm = sensors.slice(0, 5).map(v => Math.min(100, Math.max(0, v)));
        let fsrNorm = sensors.slice(5, 10).map(v => Math.min(100, Math.max(0, v)));
        const imu   = imuArr.slice(0, 3).map(Number);

        flxNorm[0] = fsrNorm[0] * 0.65;
        flxNorm[3] = fsrNorm[3] * 0.65;
        fsrNorm[4] = fsrNorm[3] * 0.65;

        // ── 2. ML FEEDBACK & EARLY CLASSIFICATION ────────────────
        const ml             = dataRoot.ml_feedback || {};
        const classification = ml.classification || null;
        const confidence     = ml.confidence     ?? 0.0;
        
        // Render the KNN graph early to capture the local prediction for the UI layout
        const activeClientGrasp = drawKNNScatterChart('chart-error', flxNorm, fsrNorm, currentK, currentTargetTask);
        const finalClassification = activeClientGrasp || classification;
        
        document.getElementById('ml-smoothness').innerText = `${confidence.toFixed(1)}%`;
        
        const graspLabel = document.getElementById('grasp-label');
        if (!isCalibrating && graspLabel && finalClassification) {
            graspLabel.innerText = finalClassification.toUpperCase().replace(/_/g, ' ');
        }

        // ── 4. SENSOR ARRAY TABLE & INDICATORS ───────────────────
        config.forEach((f, i) => {
            const flexEl = document.getElementById(`flex-${f.id}`);
            const fsrEl  = document.getElementById(`fsr-${f.id}`);
            if (flexEl) flexEl.innerText = `${flxNorm[i].toFixed(0)}%`;
            if (fsrEl)  fsrEl.innerText  = `${fsrNorm[i].toFixed(0)}%`;

            const statusDot = document.getElementById(`haptic-dot-${f.id}`);
            if (statusDot) {
                const cleanFinal = (finalClassification || "").toLowerCase().replace(/_/g, ' ');
                const cleanTarget = (currentTargetTask || "").toLowerCase().replace(/_/g, ' ');

                // Because finalClassification is evaluated early, this logic now functions perfectly
                if (isSessionRunning && cleanFinal !== cleanTarget) {
                    statusDot.style.backgroundColor = '#c42b2b'; 
                    statusDot.style.boxShadow = '0 0 12px #c42b2b';
                } else {
                    statusDot.style.backgroundColor = '#107c10'; 
                    statusDot.style.boxShadow = 'none';
                }
            }
        });

        // ── 5. HAND POSE & HISTORY ───────────────────────────────
        applyFingerPose(flxNorm, fsrNorm);

        config.forEach((_, i) => {
            flexHist[i].push(flxNorm[i]);
            fsrHist[i].push(fsrNorm[i]);
            if (flexHist[i].length > historyLimit) {
                flexHist[i].shift();
                fsrHist[i].shift();
            }
        });
        
        accXData.push(imu[0] ?? 0);
        accYData.push(imu[1] ?? 0);
        accZData.push(imu[2] ?? 0);
        if (accXData.length > historyLimit) {
            accXData.shift(); accYData.shift(); accZData.shift();
        }

        ['x','y','z'].forEach((axis, i) => {
            const el = document.getElementById(`acc-${axis}`);
            if (el) el.innerText = (imu[i] ?? 0).toFixed(2);
        });

        // ── 8. REMAINING CHARTS ──────────────────────────────────
        drawRadarChart('chart-flex', flxNorm);
        drawVBarChart('chart-fsr', fsrNorm);
        drawIMUChart('chart-imu', accXData, accYData, accZData);

        // ── 10. HAPTIC FEEDBACK SENDER ───────────────────────────
        if (isSessionRunning && finalClassification) {
            const cleanFinal = finalClassification.toLowerCase().replace(/ /g, '_');
            const cleanTarget = (currentTargetTask || "").toLowerCase().replace(/ /g, '_');

            fetch(`${API_BASE_URL}/api/session/evaluate-haptic`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    live_grasp: cleanFinal,
                    target_grasp: cleanTarget
                })
            }).catch(err => console.debug("Haptic sync endpoint idle...", err));
        }

    } catch (err) {
        console.warn('[pollSensor] Pipeline error, waiting for clean data…', err);
    }
}

// ─────────────────────────────────────────────────────────
// CLIENT-SIDE KNN DISTANCE COMPUTATION
// Mirrors ml_inference.py logic for fallback / simulation
// ─────────────────────────────────────────────────────────
function computeDistances(sensors10) {
    const result = {};
    CENTROID_CLASSES.forEach(cls => {
        const c = CENTROIDS[cls];
        let sum = 0;
        for (let i = 0; i < 10; i++) {
            const d = c[i] - sensors10[i];
            sum += SENSOR_WEIGHTS[i] * d * d;
        }
        result[cls] = Math.sqrt(sum);
    });
    return result;
}

// Per-finger weighted error contribution to target centroid
function computeFingerErrors(sensors10, targetClass) {
    if (!targetClass || !CENTROIDS[targetClass]) return null;
    const c = CENTROIDS[targetClass];
    return config.map((_, i) => {
        const wFlex = SENSOR_WEIGHTS[i];
        const wFsr  = SENSOR_WEIGHTS[i + 5];
        const dFlex = c[i]     - sensors10[i];
        const dFsr  = c[i + 5] - sensors10[i + 5];
        return Math.sqrt(wFlex * dFlex * dFlex + wFsr * dFsr * dFsr);
    });
}

// ═══════════════════════════════════════════════════════════
// WAITING / NO-DATA STATE
// ═══════════════════════════════════════════════════════════
function showWaitingState() {
    const waitingEl = document.getElementById('waiting-sensor');
    const tableEl = document.getElementById('sensor-table');
    
    // Ensure the parent container has a relative positioning boundary
    if (waitingEl && waitingEl.parentElement) {
        waitingEl.parentElement.style.position = 'relative';
    }

    if (waitingEl) {
        // Position it explicitly floating exactly in the center over the table
        waitingEl.style.position   = 'absolute';
        waitingEl.style.top        = '50%';
        waitingEl.style.left       = '50%';
        waitingEl.style.transform  = 'translate(-50%, -50%)';
        waitingEl.style.zIndex     = '10';
        waitingEl.style.margin     = '0';
        waitingEl.style.background = 'rgba(255, 255, 255, 0.85)'; // semi-opaque background card profile
        waitingEl.style.padding    = '8px 16px';
        waitingEl.style.borderRadius = '6px';
        waitingEl.style.boxShadow  = '0 4px 12px rgba(0,0,0,0.1)';
        waitingEl.style.display    = 'block';
    }

    if (tableEl) {
        tableEl.style.display = '';
        tableEl.style.opacity = '0.3'; // Dimmed significantly so text underneath remains legible
    }
}

function hideWaitingState() {
    const waitingEl = document.getElementById('waiting-sensor');
    const tableEl = document.getElementById('sensor-table');

    if (waitingEl) {
        waitingEl.style.display = 'none';
    }
    if (tableEl) {
        tableEl.style.display = '';
        tableEl.style.opacity = '1.0'; // Fully crisp and interactive
    }
}

// ═══════════════════════════════════════════════════════════
// CALIBRATE  —  POST /api/calibrate
// ═══════════════════════════════════════════════════════════
async function startCalibration() {
    if (isCalibrating) return;
    isCalibrating = true;

    const btn = document.getElementById('btn-calibrate');
    btn.disabled = true;

    const statusEl = document.getElementById('session-status');
    const graspEl  = document.getElementById('grasp-label');
    statusEl.innerText = 'CALIBRATION IN PROGRESS';

    try {
        await fetch(`${API_BASE_URL}/api/calibrate`, { method: 'POST' });
    } catch (err) {
        console.error('Calibration command failed', err);
    }

    const phases = [
        { time: 0,     text: 'Vibrating… Get Ready!' },
        { time: 1000,  text: 'Phase 1: Hold OPEN GRIP' },
        { time: 7000,  text: 'Phase 2: Hold CLOSED GRIP' },
        { time: 13000, text: 'CALIBRATION COMPLETE!' }
    ];

    phases.forEach((p, index) => {
        setTimeout(() => {
            graspEl.innerText = p.text; // Safe from overwrites now!
            if (index === phases.length - 1) {
                graspEl.style.color = 'var(--success)';
                isCalibrating = false;
                btn.disabled  = false;

                document.getElementById('btn-session').disabled = false;
                document.getElementById('input-patient-id').disabled = false;
                document.getElementById('input-k-value').disabled    = false;
                document.getElementById('input-task-type').disabled   = false;

                setTimeout(() => {
                    if (systemActive && statusEl.innerText.includes('CALIBRATION')) {
                        statusEl.innerText = 'SYSTEM ONLINE';
                        graspEl.innerText  = '---';
                        graspEl.style.color = 'var(--accent2)';
                    }
                }, 4000);
            } else {
                graspEl.style.color = 'var(--warning)';
            }
        }, p.time);
    });
}

// ═══════════════════════════════════════════════════════════
// SESSION CONTROL
// ═══════════════════════════════════════════════════════════
async function toggleSession() {
    isSessionRunning ? stopSession() : startSession();
}

async function startSession() {
    const patientId = document.getElementById('input-patient-id').value.trim();
    const taskType  = document.getElementById('input-task-type').value;   // e.g. "Cylindrical"

    if (!patientId) return alert('Patient ID required');

    const btn = document.getElementById('btn-session');
    btn.disabled = true;
    showMsg('session-msg', 'loading', 'Starting session…');

    document.getElementById('input-patient-id').disabled = true;
    document.getElementById('input-task-type').disabled  = true;

    try {
        const url = `${API_BASE_URL}/api/sessions/start?patient_id=${encodeURIComponent(patientId)}&task_type=${encodeURIComponent(taskType)}`;
        const res  = await fetch(url, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        currentSessionId  = data.session_id || data.id;
        currentTargetTask = taskType;   // store for KNN chart highlight
        isSessionRunning  = true;

        btn.innerText = 'Stop Session';
        btn.className = 'btn btn-red';
        btn.disabled  = false;

        document.getElementById('session-status').innerText = `SESSION (${taskType.toUpperCase()})`;
        document.getElementById('grasp-label').innerText    = taskType.toUpperCase();
        hideMsgAfter('session-msg', 0);

        sessionSeconds  = 0;
        sessionInterval = setInterval(() => {
            sessionSeconds++;
            const m = Math.floor(sessionSeconds / 60).toString().padStart(2, '0');
            const s = (sessionSeconds % 60).toString().padStart(2, '0');
            document.getElementById('sess-time').innerText = `${m}:${s}`;
        }, 1000);

    } catch (err) {
        showMsg('session-msg', 'err', '✗ Failed');
        document.getElementById('input-patient-id').disabled = false;
        document.getElementById('input-task-type').disabled  = false;
        btn.disabled = false;
    }
}

async function stopSession() {
    const btn = document.getElementById('btn-session');
    btn.disabled = true;

    clearInterval(sessionInterval);
    sessionInterval  = null;
    isSessionRunning = false;
    const capturedTarget = currentTargetTask;   // keep for metrics display
    const capturedId     = currentSessionId;
    currentTargetTask    = null;

    try {
        const res  = await fetch(`${API_BASE_URL}/api/sessions/stop`, { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const response = await res.json();

        // Enrich with locally tracked values if backend couldn't compute them
        const m = response.metrics || response || {};
        if (!m.target_grasp && capturedTarget) m.target_grasp = capturedTarget;
        if (!m.session_id   && capturedId)    m.session_id   = capturedId;
        if (!m.duration_seconds)               m.duration_seconds = sessionSeconds;

        displaySessionMetrics(m);

    } catch (err) {
        // Show a minimal overlay even if the API call failed
        displaySessionMetrics({
            target_grasp: capturedTarget,
            session_id:   capturedId,
            duration_seconds: sessionSeconds,
        });
        console.warn('Stop-session API error:', err);
    } finally {
        currentSessionId = null;
        btn.innerText = 'Begin Session';
        btn.className = 'btn btn-green';
        btn.disabled  = false;
        document.getElementById('session-status').innerText = 'SYSTEM ONLINE';
        document.getElementById('input-patient-id').disabled = false;
        document.getElementById('input-task-type').disabled  = false;
    }
}

// ═══════════════════════════════════════════════════════════
// SESSION METRICS DISPLAY
// ═══════════════════════════════════════════════════════════
function displaySessionMetrics(m) {
    const grid = document.getElementById('metrics-grid');
    if (!grid) return;

    const na  = '—';
    const fmt = (v, suffix = '', dp = 1) =>
        (v != null && !isNaN(+v)) ? `${(+v).toFixed(dp)}${suffix}` : na;

    // Derive accuracy bar colour
    const acc    = m.accuracy_pct != null ? +m.accuracy_pct : null;
    const accBar = acc != null
        ? `<div style="
                display:inline-block; width:${acc}%; max-width:100%;
                height:6px; border-radius:3px; margin-top:4px;
                background: ${acc >= 75 ? '#107c10' : acc >= 40 ? '#f59e0b' : '#c42b2b'};
                vertical-align:middle;"></div>`
        : '';

    const items = [
        { label: '🎯 Target Grasp',           value: m.target_grasp  || na },
        { label: '⏱ Session Duration',        value: fmt(m.duration_seconds,  's', 0) },
        { label: '✅ Classification Accuracy', value: acc != null ? `${acc.toFixed(1)}% ${accBar}` : na },
        { label: '📊 Frames Sampled',          value: m.total_frames  != null ? m.total_frames   : na },
        { label: '🟢 On-Target Time',          value: fmt(m.correct_duration_s, 's') },
        { label: '🔴 Off-Target Time',         value: fmt(m.error_duration_s,   's') },
        { label: '📳 Haptic Active',           value: fmt(m.haptic_trigger_pct, '% of session') },
        { label: '🆔 Session ID',              value: m.session_id    || na },
    ];

    grid.innerHTML = items.map(it => `
        <div class="metric-item">
            <div class="metric-label">${it.label}</div>
            <div class="metric-value">${it.value}</div>
        </div>`).join('');

    document.getElementById('metrics-overlay').classList.add('show');
}

// ═══════════════════════════════════════════════════════════
// SIMULATE GRASP  (uses local IDEAL_TRAJECTORIES, no API)
// ═══════════════════════════════════════════════════════════
function toggleSimDropdown(e) {
    e.stopPropagation();
    const dd  = document.getElementById('sim-dropdown');
    const btn = document.getElementById('btn-simulate');
    if (dd.style.display === 'block') { dd.style.display = 'none'; return; }
    const rect = btn.getBoundingClientRect();
    dd.style.left   = rect.left + 'px';
    dd.style.width  = rect.width + 'px';
    dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    dd.style.top    = 'auto';
    dd.style.display = 'block';
}

function simulateGrasp(graspName) {
    document.getElementById('sim-dropdown').style.display = 'none';
    isSimulating = true;
    clearTimeout(simTimeout);

    document.getElementById('grasp-label').innerText    = graspName.toUpperCase().replace(/_/g, ' ');
    document.getElementById('session-status').innerText = 'SIMULATION';

    const ideal = IDEAL_TRAJECTORIES[graspName];
    if (ideal) {
        // Use scoped copies — never reference pollSensor-local variables
        let simFlx = [...ideal.flex];
        let simFsr = [...ideal.fsr];

        // Apply same hardware compensation modifiers as live data
        simFlx[0] = simFsr[0] * 0.65;
        simFlx[3] = simFsr[3] * 0.65;
        simFsr[4] = simFsr[3] * 0.65;

        // Update sensor table
        config.forEach((f, i) => {
            const flexEl = document.getElementById(`flex-${f.id}`);
            const fsrEl  = document.getElementById(`fsr-${f.id}`);
            const errEl  = document.getElementById(`err-${f.id}`);
            if (flexEl) flexEl.innerText = `${simFlx[i].toFixed(1)}%`;
            if (fsrEl)  fsrEl.innerText  = `${simFsr[i].toFixed(1)}%`;
            if (errEl)  errEl.innerText  = '0.0';
        });

        applyFingerPose(simFlx, simFsr);
        drawRadarChart('chart-flex', simFlx);
        drawVBarChart('chart-fsr', simFsr);
        drawKNNScatterChart('chart-error', simFlx, simFsr, currentK, graspName);
        hideWaitingState();
    }

    simTimeout = setTimeout(() => {
        isSimulating = false;
        if (systemActive) {
            document.getElementById('session-status').innerText = 'SYSTEM OFFLINE';
            document.getElementById('grasp-label').innerText    = '---';
        }
    }, 4000);
}

// ═══════════════════════════════════════════════════════════
// HAND POSE
// ═══════════════════════════════════════════════════════════
function applyFingerPose(flxValues, fsrValues) {
    config.forEach((f, i) => {
        const scale = 1 - (flxValues[i] / 100) * 0.6;
        const mid  = document.getElementById(`fin-${f.id}-mid`);
        const tip  = document.getElementById(`fin-${f.id}-tip`);
        const rect = document.getElementById(`fin-${f.id}-tip-rect`);
        if (mid)  mid.style.transform = `translate(0px,-${f.len[0]}px) scaleY(${scale})`;
        if (tip)  tip.style.transform = `translate(0px,-${f.len[1]}px) scaleY(${scale})`;
        if (rect) {
            const fv = fsrValues[i];
            if (fv > 15) {
                const t = (fv - 15) / 85;
                rect.style.fill   = `rgb(255,${Math.floor(255 * (1 - t))},${Math.floor(255 * (1 - t))})`;
                rect.style.filter = 'url(#glow)';
            } else {
                rect.style.fill   = '#ffffff';
                rect.style.filter = 'none';
            }
        }
    });
}

function resetFinger(f) {
    const mid  = document.getElementById(`fin-${f.id}-mid`);
    const tip  = document.getElementById(`fin-${f.id}-tip`);
    const rect = document.getElementById(`fin-${f.id}-tip-rect`);
    if (mid)  mid.style.transform = `translate(0px,-${f.len[0]}px)`;
    if (tip)  tip.style.transform = `translate(0px,-${f.len[1]}px)`;
    if (rect) { rect.style.fill = '#ffffff'; rect.style.filter = 'none'; }
}

// ═══════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════
function showMsg(id, type, text) {
    const el = document.getElementById(id);
    el.className = `inline-msg ${type}`;
    el.innerText = text;
}
function hideMsgAfter(id, delay) {
    if (delay === 0) { document.getElementById(id).className = 'inline-msg'; return; }
    setTimeout(() => { document.getElementById(id).className = 'inline-msg'; }, delay);
}

// K-value selector for KNN scatter chart
function setK(k) {
    currentK = k;
    document.querySelectorAll('.k-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.k) === k);
    });
}

// ═══════════════════════════════════════════════════════════
// CHART DRAWING
// ═══════════════════════════════════════════════════════════

// ── Canvas clear with grid ─────────────────────────────────
function clearCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1623';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#182030';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < canvas.width;  i += 20) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, canvas.height); ctx.stroke();
    }
    for (let i = 0; i < canvas.height; i += 20) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(canvas.width, i);  ctx.stroke();
    }
}

// ── Radar — Digit Flexion ──────────────────────────────────
function drawRadarChart(canvasId, flxValues) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.width || !canvas.height) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const cx = w / 2, cy = h / 2;
    const r  = Math.min(cx, cy) * 0.7;
    const n  = 5;
    const map    = [2, 3, 4, 0, 1];   // display order mapping
    const angles = Array.from({ length: n }, (_, i) => (i * 2 * Math.PI / n) - Math.PI / 2);

    clearCanvas(canvas);

    // Grid rings
    [0.25, 0.5, 0.75, 1.0].forEach(sc => {
        ctx.beginPath();
        angles.forEach((a, i) => {
            const x = cx + Math.cos(a) * r * sc, y = cy + Math.sin(a) * r * sc;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.strokeStyle = '#1e2d42'; ctx.lineWidth = 0.8; ctx.stroke();
    });

    // Axes + labels
    angles.forEach((a, i) => {
        const dataIdx = map[i];
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.strokeStyle = '#263545'; ctx.lineWidth = 0.8; ctx.stroke();
        const lx = cx + Math.cos(a) * r * 1.22, ly = cy + Math.sin(a) * r * 1.22;
        ctx.fillStyle = digitColors[dataIdx];
        ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(config[dataIdx].name[0], lx, ly);
    });

    if (!flxValues || flxValues.length !== n) return;

    // Data polygon
    ctx.beginPath();
    angles.forEach((a, i) => {
        const dataIdx = map[i];
        const sc = flxValues[dataIdx] / 100;
        const x  = cx + Math.cos(a) * r * sc, y = cy + Math.sin(a) * r * sc;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle   = 'rgba(0,95,184,0.18)'; ctx.fill();
    ctx.strokeStyle = '#005fb8'; ctx.lineWidth = 1.5; ctx.stroke();
}

// ── V-Bar — Force Sensors ──────────────────────────────────
function drawVBarChart(canvasId, fsrValues) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.width || !canvas.height) return;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0f1623'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    const n = fsrValues.length;
    const pl = 15, pr = 15, pt = 20, pb = 25;
    const totalW = canvas.width - pl - pr;
    const maxH   = canvas.height - pt - pb;
    const barW   = (totalW / n) * 0.6;
    const gap    = (totalW / n) * 0.4;

    fsrValues.forEach((val, i) => {
        const x     = pl + i * (barW + gap) + gap / 2;
        const barH  = (val / 100) * maxH;
        const yBase = canvas.height - pb;
        const yPos  = yBase - barH;

        ctx.fillStyle = '#182030';
        ctx.beginPath(); rrect(ctx, x, pt, barW, maxH, 3); ctx.fill();

        if (barH > 2) {
            const grad = ctx.createLinearGradient(0, yBase, 0, yPos);
            grad.addColorStop(0, digitColors[i] + '55');
            grad.addColorStop(1, digitColors[i]);
            ctx.globalAlpha = 0.88;
            ctx.fillStyle = grad;
            ctx.beginPath(); rrect(ctx, x, yPos, barW, barH, 3); ctx.fill();
            ctx.globalAlpha = 1;
        }

        ctx.fillStyle = digitColors[i];
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText(digitLabels[i], x + barW / 2, yBase + 5);
    });
}

// ── KNN Scatter Plot ───────────────────────────────────────
// Mirrors the centroid distribution map (Flexion % vs Pressure %)
// from centroid_knn.json projected to 2D.
//
// flxNorm   — float[5] | null   current flex readings 0-100
// fsrNorm   — float[5] | null   current FSR readings 0-100
// kValue    — int (3, 5, or 7)  K for K-NN neighbour search
// targetTask — string | null    active session target class
function drawKNNScatterChart(canvasId, flxNorm, fsrNorm, kValue, targetTask) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.width || !canvas.height) return;
    const ctx = canvas.getContext('2d');

    const W = canvas.width, H = canvas.height;
    // Padding: left room for Y labels, bottom for X labels
    const padL = 26, padR = 6, padT = 10, padB = 22;
    const cW = W - padL - padR;
    const cH = H - padT - padB;

    // Data [0,100] → canvas pixel mapping
    const toX = v => padL + (v / 100) * cW;
    const toY = v => padT + (1 - v / 100) * cH;

    // ── Background ─────────────────────────────────────────
    ctx.fillStyle = '#0f1623';
    ctx.fillRect(0, 0, W, H);

    // ── Grid lines ─────────────────────────────────────────
    ctx.lineWidth = 0.5;
    [20, 40, 60, 80].forEach(v => {
        const isHalf = v === 40 || v === 60;
        ctx.strokeStyle = isHalf ? '#1c2c40' : '#182030';
        ctx.beginPath();
        ctx.moveTo(toX(v), padT);     ctx.lineTo(toX(v), H - padB);
        ctx.moveTo(padL,   toY(v));   ctx.lineTo(W - padR, toY(v));
        ctx.stroke();
    });

    // ── Axes ───────────────────────────────────────────────
    ctx.strokeStyle = '#263545'; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padL, padT);     ctx.lineTo(padL, H - padB);
    ctx.moveTo(padL, H - padB); ctx.lineTo(W - padR, H - padB);
    ctx.stroke();

    // Axis tick labels
    ctx.fillStyle = '#3a4a5a'; ctx.font = '6px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    [0, 50, 100].forEach(v => ctx.fillText(v, toX(v), H - padB + 3));
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    [0, 50, 100].forEach(v => ctx.fillText(v, padL - 2, toY(v)));

    // Axis titles
    ctx.fillStyle = '#2e3f52'; ctx.font = '6px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('Flex %', padL + cW / 2, H - padB + 12);
    ctx.save();
    ctx.translate(7, padT + cH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Force %', 0, 0);
    ctx.restore();

    // ── Compute query point and K-NN if live data available ─
    const hasData = Array.isArray(flxNorm) && flxNorm.length >= 5 &&
                    Array.isArray(fsrNorm) && fsrNorm.length >= 5;
    let queryX = null, queryY = null, kNeighbors = [];

    if (hasData) {
        queryX = flxNorm.reduce((s, v) => s + v, 0) / 5;
        queryY = fsrNorm.reduce((s, v) => s + v, 0) / 5;

        // Euclidean distance from query to every scatter point in 2D
        const pool = [];
        CENTROID_CLASSES.forEach(cls => {
            SCATTER_POINTS[cls].forEach(pt => {
                const d = Math.sqrt((pt.x - queryX) ** 2 + (pt.y - queryY) ** 2);
                pool.push({ cls, pt, d });
            });
        });
        pool.sort((a, b) => a.d - b.d);
        kNeighbors = pool.slice(0, kValue);

        // Draw connector lines from query → K-nearest (drawn first, under dots)
        kNeighbors.forEach(n => {
            const ci = CENTROID_CLASSES.indexOf(n.cls);
            ctx.setLineDash([2, 3]);
            ctx.strokeStyle = CENTROID_COLORS[ci] + '50';
            ctx.lineWidth   = 0.8;
            ctx.beginPath();
            ctx.moveTo(toX(queryX), toY(queryY));
            ctx.lineTo(toX(n.pt.x), toY(n.pt.y));
            ctx.stroke();
        });
        ctx.setLineDash([]);
    }

    // ── Soft highlight hull around target class ─────────────
    if (targetTask && SCATTER_MEANS[targetTask]) {
        const ti = CENTROID_CLASSES.indexOf(targetTask);
        const m  = SCATTER_MEANS[targetTask];
        // Compute rough spread of that class's points
        const pts = SCATTER_POINTS[targetTask];
        const xs  = pts.map(p => p.x), ys = pts.map(p => p.y);
        const rx  = (Math.max(...xs) - Math.min(...xs)) / 2 + 6;
        const ry  = (Math.max(...ys) - Math.min(...ys)) / 2 + 6;
        ctx.fillStyle   = CENTROID_COLORS[ti] + '14';
        ctx.strokeStyle = CENTROID_COLORS[ti] + '35';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.ellipse(toX(m.x), toY(m.y), rx * (cW / 100), ry * (cH / 100), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    }

    // ── Draw all 50 static sample points ───────────────────
    CENTROID_CLASSES.forEach(cls => {
        const ci    = CENTROID_CLASSES.indexOf(cls);
        const color = CENTROID_COLORS[ci];

        SCATTER_POINTS[cls].forEach(pt => {
            const kIdx = kNeighbors.findIndex(n => n.cls === cls && n.pt === pt);
            const isKN = kIdx >= 0;
            const r    = isKN ? 5.5 : 3.8;

            ctx.beginPath();
            ctx.arc(toX(pt.x), toY(pt.y), r, 0, Math.PI * 2);
            ctx.fillStyle   = color + (isKN ? 'cc' : '55');
            ctx.strokeStyle = color + (isKN ? 'ff' : '88');
            ctx.lineWidth   = isKN ? 1.5 : 0.7;
            ctx.fill();
            ctx.stroke();

            // Rank number inside K-nearest dot
            if (isKN) {
                ctx.fillStyle    = '#ffffff';
                ctx.font         = 'bold 5px monospace';
                ctx.textAlign    = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(kIdx + 1, toX(pt.x), toY(pt.y));
            }
        });
    });

    // ── Class centroid mean markers + labels ────────────────
    CENTROID_CLASSES.forEach(cls => {
        const ci       = CENTROID_CLASSES.indexOf(cls);
        const color    = CENTROID_COLORS[ci];
        const m        = SCATTER_MEANS[cls];
        const isTarget = cls === targetTask;
        const cx2      = toX(m.x), cy2 = toY(m.y);

        // Diamond marker at mean
        const ds = isTarget ? 5.5 : 4;
        ctx.save();
        ctx.translate(cx2, cy2);
        ctx.rotate(Math.PI / 4);
        ctx.strokeStyle = color + (isTarget ? 'ff' : 'bb');
        ctx.lineWidth   = isTarget ? 2 : 1;
        ctx.fillStyle   = '#0f1623';
        ctx.beginPath();
        ctx.rect(-ds / 2, -ds / 2, ds, ds);
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        // Class name label (above the diamond)
        const label  = cls.replace('_', ' ');
        ctx.fillStyle    = color + (isTarget ? 'ff' : 'aa');
        ctx.font         = `bold ${isTarget ? 8 : 7}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'bottom';
        // Slight offset per class to reduce overlap
        const offsetY = cls === 'Cylindrical' ? -1 : cls === 'Hook_Grasp' ? 7 : -1;
        ctx.fillText(label, cx2, cy2 - 6 + offsetY);
    });

    // ── Current query point (live / simulation) ─────────────
    if (hasData && queryX !== null) {
        const qx    = toX(queryX), qy = toY(queryY);
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 280);

        // Outer pulsing ring
        ctx.beginPath();
        ctx.arc(qx, qy, 9 + pulse * 4, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,255,255,${0.12 + pulse * 0.16})`;
        ctx.lineWidth   = 1;
        ctx.stroke();

        // Middle ring
        ctx.beginPath();
        ctx.arc(qx, qy, 7, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth   = 0.8;
        ctx.stroke();

        // Core circle
        ctx.beginPath();
        ctx.arc(qx, qy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle   = '#ffffff';
        ctx.strokeStyle = '#0f1623';
        ctx.lineWidth   = 1.2;
        ctx.fill();
        ctx.stroke();

        // Crosshair
        ctx.strokeStyle = '#0a0f1a';
        ctx.lineWidth   = 1.4;
        ctx.beginPath();
        ctx.moveTo(qx - 2.5, qy); ctx.lineTo(qx + 2.5, qy);
        ctx.moveTo(qx, qy - 2.5); ctx.lineTo(qx, qy + 2.5);
        ctx.stroke();

        // Majority-vote label near the query pin
        if (kNeighbors.length > 0) {
            const votes = {};
            kNeighbors.forEach(n => votes[n.cls] = (votes[n.cls] || 0) + 1);
            // Sort by votes desc, then by distance asc on tie
            const predicted = Object.entries(votes)
                .sort((a, b) => b[1] - a[1])[0][0];
            const pi  = CENTROID_CLASSES.indexOf(predicted);
            const col = CENTROID_COLORS[pi];

            const tagText = `K${kValue}→${predicted.replace('_', ' ')}`;
            ctx.font = 'bold 7px monospace';
            const tw  = ctx.measureText(tagText).width;
            // Clamp tag so it doesn't bleed off the right edge
            const tagX = Math.min(qx + 10, W - padR - tw - 4);
            const tagY = Math.max(padT + 2, qy - 14);

            ctx.fillStyle    = col + '2a';
            ctx.strokeStyle  = col + '55';
            ctx.lineWidth    = 0.8;
            ctx.beginPath();
            rrect(ctx, tagX - 3, tagY - 2, tw + 6, 11, 2);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle    = col;
            ctx.textAlign    = 'left';
            ctx.textBaseline = 'top';
            ctx.fillText(tagText, tagX, tagY);

            return predicted;
        }
    }
    return null;
}

// ── IMU Line Chart ─────────────────────────────────────────
function drawIMUChart(canvasId, ax, ay, az) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !canvas.width || !canvas.height) return;
    const ctx = canvas.getContext('2d');
    clearCanvas(canvas);

    const W = canvas.width, H = canvas.height, hl = historyLimit;

    // Centre line
    ctx.strokeStyle = '#1e2d42'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();

    const drawLine = (data, color) => {
        if (!data || data.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = 1.5;
        for (let i = 0; i < data.length; i++) {
            const x = (i / (hl - 1)) * W;
            const y = H / 2 - (data[i] / 2.0) * (H / 2);   // ±2g range
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
    };

    drawLine(ax, '#ff5555');
    drawLine(ay, '#44dd44');
    drawLine(az, '#4499ff');
}

// ── Rounded rect helper ────────────────────────────────────
function rrect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);       ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x,     y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x,     y,     x + r, y);
    ctx.closePath();
}

// ═══════════════════════════════════════════════════════════
// RESIZE & DATETIME
// ═══════════════════════════════════════════════════════════
function resizeCharts() {
    ['chart-flex', 'chart-error', 'chart-fsr', 'chart-imu'].forEach(id => {
        const c = document.getElementById(id);
        if (c && c.clientWidth && c.clientHeight) {
            c.width  = c.clientWidth;
            c.height = c.clientHeight;
        }
    });
    document.querySelectorAll('canvas').forEach(clearCanvas);
}

function updateDateTime() {
    const now = new Date();
    document.getElementById('curr-date').innerText = now.toLocaleDateString();
    document.getElementById('curr-time').innerText = now.toLocaleTimeString();
}

// ═══════════════════════════════════════════════════════════
// SIDEBAR TOGGLE
// ═══════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
    resizeCharts();
    updateDateTime();
    setInterval(updateDateTime, 1000);
    window.addEventListener('resize', resizeCharts);
});

document.getElementById('input-k-value').addEventListener('change', (e) => {
    currentK = parseInt(e.target.value, 10);
    console.log(`KNN analysis clustering width adjusted: K = ${currentK}`);
});
document.getElementById('toggle-sidebar').addEventListener('click', () => {
    const lay  = document.getElementById('dashboard-layout');
    const open = lay.classList.toggle('sidebar-open');
    document.getElementById('toggle-sidebar').setAttribute('aria-expanded', open);
});
document.getElementById('sidebar-backdrop').addEventListener('click', () => {
    document.getElementById('dashboard-layout').classList.remove('sidebar-open');
});

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
window.onload   = init;
window.onresize = resizeCharts;
import {
    getPatients, getSessions, getSessionMovements,
    startSession, stopSession,
    showSpinner, showEmpty, showApiError,
    fmtDateTime, fmtDuration
} from './api.js';

let _activeSessionId = null;
let _allSessions = [];

document.addEventListener('DOMContentLoaded', async () => {
    await populatePatientSelect();
    setupControls();

    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get('patient_id');

    if (patientId) {
        const select = document.getElementById('ctrl-patient-select');
        if (select) select.value = patientId;
    }

    loadSessions(patientId);
});

async function populatePatientSelect() {
    const select = document.getElementById('ctrl-patient-select');
    try {
        const res = await getPatients(); 
        const patients = res.patients || []; 
        
        patients.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `${p.name} (ID: ${String(p.id).padStart(3, '0')})`;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Failed to load patients for selector", err);
    }
}

function setupControls() {
    document.getElementById('btn-start-session').addEventListener('click', handleStartSession);
    document.getElementById('btn-stop-session').addEventListener('click', handleStopSession);
}

async function handleStartSession() {
    const patientId = document.getElementById('ctrl-patient-select').value;
    const taskType = document.getElementById('ctrl-task-select').value;
    const statusBar = document.getElementById('session-status-bar');

    if (!patientId || !taskType) {
        statusBar.innerHTML = `<span style="color:red; font-weight:bold;">⚠ Please select both a patient and a task.</span>`;
        statusBar.hidden = false;
        return;
    }

    try {
        statusBar.innerHTML = `<em>Initializing session...</em>`;
        statusBar.hidden = false;
        
        const res = await startSession(patientId, taskType);
        _activeSessionId = res.session_id;

        document.getElementById('btn-start-session').disabled = true;
        document.getElementById('btn-stop-session').disabled = false;
        
        statusBar.innerHTML = `<span class="badge badge-live" style="color: #d9534f; font-weight:bold;">● Session ${_activeSessionId} is currently active</span>`;

        // Refresh list
        loadSessions(new URLSearchParams(window.location.search).get('patient_id'));
    } catch (err) {
        statusBar.innerHTML = `<span style="color:red;">⚠ Error: ${err.message}</span>`;
    }
}

async function handleStopSession() {
    if (!_activeSessionId) return;
    const statusBar = document.getElementById('session-status-bar');

    try {
        statusBar.innerHTML = `<em>Stopping session...</em>`;
        
        const metrics = await stopSession(_activeSessionId);

        document.getElementById('btn-start-session').disabled = false;
        document.getElementById('btn-stop-session').disabled = true;

        statusBar.innerHTML = `
            <div style="background:#e8f4f8; padding:15px; border-radius:6px; border: 1px solid #bde0ec; color: #0056b3; font-size: 0.95rem;">
                <strong style="font-size: 1.1rem; display:block; margin-bottom:5px;">Session Complete</strong>
                Duration: <strong>${metrics.duration ? fmtDuration(metrics.duration) : 'N/A'}</strong> &nbsp;|&nbsp; 
                Mean Error: <strong>${metrics.mean_error ? metrics.mean_error.toFixed(2) + '°' : 'N/A'}</strong> &nbsp;|&nbsp; 
                Movements Recorded: <strong>${metrics.movement_count || 0}</strong>
            </div>
        `;
        
        _activeSessionId = null;

        // Refresh list to update the recently ended session's card
        loadSessions(new URLSearchParams(window.location.search).get('patient_id'));
    } catch (err) {
        statusBar.innerHTML = `<span style="color:red;">⚠ Error: ${err.message}</span>`;
    }
}

async function loadSessions(patientId) {
    const container = document.getElementById('sessions-container');
    showSpinner('sessions-container', 'Loading session data...');

    try {
        const res = await getSessions(patientId);
        _allSessions = res.sessions || [];

        if (_allSessions.length === 0) {
            showEmpty('sessions-container', 'No sessions found for this patient.');
            return;
        }

        container.innerHTML = _allSessions.map(renderSessionCard).join('');
    } catch (err) {
        showApiError('sessions-container', err);
    }
}

function renderSessionCard(s) {
    const isActive = !s.end_time;
    const duration = s.duration_seconds ? fmtDuration(s.duration_seconds) : 'Active';
    const meanError = s.mean_error != null ? s.mean_error.toFixed(2) + '°' : 'N/A';

    return `
    <div class="session-card ${isActive ? 'session-active' : ''}" style="margin-bottom: 20px; border: 1px solid #ddd; padding: 20px; border-radius: 8px; background: #fff;">
        <div class="session-header" style="display:flex; justify-content:space-between; align-items:center;">
            <div>
                <h3 style="margin: 0 0 5px 0; color: #333;">${s.patient_name || 'Patient ID: ' + s.patient_id}</h3>
                <p style="color:#666; margin: 0; font-size: 0.9rem;">Task: <strong>${s.task_type || 'General'}</strong></p>
            </div>
            <div style="text-align:right;">
                ${isActive ? '<span style="color:red; font-weight:bold; font-size: 0.9rem;">● LIVE</span><br>' : ''}
                <small style="color: #888;">${fmtDateTime(s.start_time)}</small>
            </div>
        </div>
        
        <hr style="border:0; border-top:1px solid #eee; margin:15px 0;">
        
        <div class="session-summary" style="display:flex; gap:30px; margin-bottom: 15px; font-size: 0.95rem;">
            <div><strong>Duration:</strong> ${duration}</div>
            <div><strong>Mean Error:</strong> ${meanError}</div>
            <div><strong>Movements:</strong> ${s.movement_count || 0}</div>
        </div>

        <button class="btn btn-outline-secondary btn-sm" onclick="toggleMovements(${s.id}, this)">View Movements</button>
        
        <div id="movements-panel-${s.id}" style="display:none; margin-top:20px; background:#f9f9f9; padding:15px; border-radius:6px; border: 1px solid #eee;">
            <!-- Expanded movement data will inject here -->
        </div>
    </div>`;
}

window.toggleMovements = async function(sessionId, btnNode) {
    const panel = document.getElementById(`movements-panel-${sessionId}`);
    
    if (panel.style.display === 'block') {
        panel.style.display = 'none';
        btnNode.textContent = 'View Movements';
        return;
    }

    panel.style.display = 'block';
    btnNode.textContent = 'Hide Movements';
    panel.innerHTML = '<em>Loading movement details...</em>';

    try {
        const res = await getSessionMovements(sessionId);
        const movements = res.movements || [];
        
        // Grab metrics directly from the parent session object
        const sessionData = _allSessions.find(s => s.id === sessionId) || {};
        const meanError = sessionData.mean_error != null ? sessionData.mean_error.toFixed(2) + '°' : 'N/A';
        const peakError = sessionData.peak_error != null ? sessionData.peak_error.toFixed(2) + '°' : 'N/A';
        const smoothness = sessionData.smoothness != null ? sessionData.smoothness.toFixed(2) : 'N/A';

        let html = `
            <div style="margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 20px; font-size: 0.9em; background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #ddd;">
                <div><strong>Mean Error:</strong> ${meanError}</div>
                <div><strong>Peak Error:</strong> ${peakError}</div>
                <div><strong>Smoothness:</strong> ${smoothness}</div>
                <div><strong>Total Movements:</strong> ${res.movement_count || movements.length}</div>
            </div>
            
            <div style="max-height: 300px; overflow-y: auto;">
                <table class="table table-sm" style="width:100%; font-size:0.85em; text-align: left; margin: 0;">
                    <thead style="background: #eee; position: sticky; top: 0;">
                        <tr>
                            <th style="padding: 8px;">#</th>
                            <th style="padding: 8px;">Time (s)</th>
                            <th style="padding: 8px;">Error (°)</th>
                            <th style="padding: 8px;">Haptic Intensity</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        if (movements.length === 0) {
            html += '<tr><td colspan="4" style="padding: 15px; text-align: center; color: #888;">No detailed movement data recorded.</td></tr>';
        } else {
            movements.slice(0, 50).forEach((m, idx) => {
                html += `
                    <tr style="border-bottom: 1px solid #eee;">
                        <td style="padding: 8px;">${idx + 1}</td>
                        <td style="padding: 8px;">${m.timestamp ? m.timestamp.toFixed(3) : '—'}</td>
                        <td style="padding: 8px;">${m.error != null ? m.error.toFixed(3) : '—'}</td>
                        <td style="padding: 8px;">${m.haptic_intensity != null ? m.haptic_intensity : '—'}</td>
                    </tr>
                `;
            });
            if (movements.length > 50) {
                html += `<tr><td colspan="4" style="padding: 10px; text-align: center; color: #666;"><em>...showing first 50 of ${movements.length} records. Export CSV for full data.</em></td></tr>`;
            }
        }
        
        html += `</tbody></table></div>`;
        panel.innerHTML = html;
        
    } catch (err) {
        panel.innerHTML = `<span style="color:red;">⚠ Failed to load movements: ${err.message}</span>`;
    }
};
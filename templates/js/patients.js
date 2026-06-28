document.addEventListener('DOMContentLoaded', () => {
    loadPatients();
    initFormToggle();
});

/**
 * Toggle the visibility of the Add Patient form
 */
function initFormToggle() {
    const btn = document.getElementById('btn-show-add-form');
    const container = document.getElementById('add-patient-container');
    const form = document.getElementById('form-add-patient');

    btn.addEventListener('click', () => {
        const isHidden = container.style.display === 'none';
        container.style.display = isHidden ? 'block' : 'none';
        btn.textContent = isHidden ? 'Cancel' : '+ Add Patient';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await createPatient();
    });
}

/**
 * API #10: POST /api/patients
 */
async function createPatient() {
    const payload = {
        name: document.getElementById('in-name').value,
        condition: document.getElementById('in-condition').value,
        rehabilitation_date: document.getElementById('in-rehab-date').value,
        next_session_date: document.getElementById('in-next-session').value,
        session_count: 0,
        status: "Active"
    };

    try {
        const response = await fetch('/api/patients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            document.getElementById('form-add-patient').reset();
            document.getElementById('add-patient-container').style.display = 'none';
            document.getElementById('btn-show-add-form').textContent = '+ Add Patient';
            loadPatients(); // Re-render grid to show the new patient
        }
    } catch (error) {
        console.error("Error adding patient:", error);
    }
}

/**
 * API #8: GET /api/patients
 */
async function loadPatients() {
    const grid = document.getElementById('patients-grid');
    const loader = document.getElementById('loading-indicator');
    
    loader.style.display = 'block';
    grid.innerHTML = '';

    try {
        const response = await fetch('/api/patients');
        const result = await response.json();
        const patients = result.patients;

        if (!patients || patients.length === 0) {
            grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999;">No patients found.</p>';
            return;
        }

        patients.forEach(patient => {
            const card = document.createElement('div');
            card.className = 'patient-card';
            
            // Format ID for "Patient #00X" display[cite: 6]
            const displayId = String(patient.id).padStart(3, '0');

            card.innerHTML = `
                <div class="patient-header">
                    <img src="css/images/person-icon.png" alt="${patient.name}" class="patient-image" />
                    <div class="patient-info">
                        <span class="patient-number">Patient #00${displayId}</span>
                        <h3 class="patient-name">${patient.name}</h3>
                    </div>
                </div>
                <div class="patient-divider"></div>
                <div class="patient-details">
                    <div class="detail-item">
                        <span class="detail-label">Rehabilitation Date</span>
                        <span class="detail-value">${patient.rehabilitation_date}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Current Session</span>
                        <span class="detail-value">#${patient.session_count}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Next Session</span>
                        <span class="detail-value">${patient.next_session_date || 'TBD'}</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Status</span>
                        <span class="detail-value">${patient.status}</span>
                    </div>
                </div>
                <div style="margin-top: 16px; text-align: right;">
                    <!-- Redirects to sessions with patient filter[cite: 6] -->
                    <a href="sessions.html?patient_id=${patient.id}" class="btn btn-sm btn-outline-primary" style="border-radius: 8px;">View Sessions →</a>
                </div>
            `;
            grid.appendChild(card);
        });
    } catch (error) {
        console.error("Error loading patients:", error);
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: red;">Failed to connect to API.</p>';
    } finally {
        loader.style.display = 'none';
    }
}
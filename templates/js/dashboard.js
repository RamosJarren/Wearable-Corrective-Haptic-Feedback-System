document.addEventListener('DOMContentLoaded', () => {
    fetchStats();
    fetchRecentPatients();
    fetchUpcomingSessions();
});

/**
 * Fetch overview statistics and update the UI
 * Uses API #7: GET /api/dashboard/stats
 */
async function fetchStats() {
    try {
        const response = await fetch('/api/dashboard/stats');
        const stats = await response.json();

        document.getElementById('stat-active-patients').textContent = stats.active_patients;
        document.getElementById('stat-total-sessions').textContent = stats.total_sessions;
        document.getElementById('stat-upcoming-sessions').textContent = stats.upcoming_sessions;
        document.getElementById('stat-current-year').textContent = stats.current_year;
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
    }
}

/**
 * Fetch patients and render the first 3
 * Uses API #8: GET /api/patients
 */
async function fetchRecentPatients() {
    try {
        const response = await fetch('/api/patients');
        const patients = await response.json();
        
        const container = document.getElementById('recent-patients-list');
        container.innerHTML = ''; // Clear existing hardcoded items

        patients.slice(0, 3).forEach(patient => {
            const item = document.createElement('div');
            item.className = 'recent-item';
            item.innerHTML = `
                <div class="recent-item-info">
                    <span class="recent-item-name">${patient.name}</span>
                    <span class="recent-item-date">Session #${patient.session_count} • Rehab: ${patient.rehabilitation_date}</span>
                </div>
                <a href="patients.html" class="recent-item-link">View →</a>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error fetching recent patients:', error);
    }
}

/**
 * Fetch sessions, filter for active/future ones, and render the first 3
 * Uses API #11: GET /api/sessions
 */
async function fetchUpcomingSessions() {
    try {
        const response = await fetch('/api/sessions');
        const sessions = await response.json();
        
        const container = document.getElementById('upcoming-sessions-list');
        container.innerHTML = ''; // Clear existing hardcoded items

        // Filter: sessions where end_time is null (active/future)
        const upcoming = sessions.filter(session => session.end_time === null);

        upcoming.slice(0, 3).forEach(session => {
            const item = document.createElement('div');
            item.className = 'recent-item';
            item.innerHTML = `
                <div class="recent-item-info">
                    <span class="recent-item-name">${session.patient_name}</span>
                    <span class="recent-item-date">Next Session: ${session.start_time}</span>
                </div>
                <a href="sessions.html" class="recent-item-link">Details →</a>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error fetching upcoming sessions:', error);
    }
}
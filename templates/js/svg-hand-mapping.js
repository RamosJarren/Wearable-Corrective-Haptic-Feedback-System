const grasps = {
	"Open_Grip":   {"fsr": [0, 20],   "flx": [0, 20]},
	"Closed_Grip": {"fsr": [90, 100], "flx": [90, 100]},
	"Cylindrical": {"fsr": [80, 100], "flx": [45, 65]},
	"Spherical":   {"fsr": [65, 85],  "flx": [55, 75]},
	"Hook_Grasp":  {"fsr": [0, 20],   "flx": [80, 100]}
};

const config = [
	{ id: 'T', name: 'Thumb', x: 88, y: 225, baseRot: -40, len: [35, 28, 20] },
	{ id: 'I', name: 'Index', x: 110, y: 160, baseRot: -5, len: [45, 32, 22] },
	{ id: 'M', name: 'Middle', x: 135, y: 160, baseRot: 0, len: [50, 38, 25] },
	{ id: 'R', name: 'Ring', x: 165, y: 160, baseRot: 5, len: [45, 32, 22] },
	{ id: 'P', name: 'Pinky', x: 190, y: 160, baseRot: 15, len: [32, 24, 18] }
];

let systemActive = false, isCalibrating = false, isSessionRunning = false;
let sessionSeconds = 0, sessionInterval = null, dataInterval = null;

// Arrays for each digit to facilitate individual plotting
let flexHist = config.map(() => []);
let fsrHist = config.map(() => []);
let accXData = [], accYData = [], accZData = [];

const historyLimit = 150;
const updateRate = 100; 
const digitColors = ['#00aff0', '#ff3333', '#33ff33', '#ffaa00', '#cc33ff'];

function init() {
	const fingerLayer = document.getElementById('finger-layer');
	const fingerLog = document.getElementById('finger-data-log');
	fingerLog.innerHTML = ""; 
	config.forEach(f => {
		fingerLayer.insertAdjacentHTML('beforeend', `
			<g id="fin-${f.id}-base" transform="translate(${f.x},${f.y}) rotate(${f.baseRot})">
				<rect width="14" height="${f.len[0]}" x="-7" y="-${f.len[0]}" rx="7" fill="#e2e8f0" stroke="#005fb8" stroke-width="0.8"/>
				<g transform="translate(0, -${f.len[0]})">
					<rect width="12" height="${f.len[1]}" x="-6" y="-${f.len[1]}" rx="6" fill="#e2e8f0" stroke="#005fb8" stroke-width="0.8"/>
					<g transform="translate(0, -${f.len[1]})">
						<rect width="10" height="${f.len[2]}" x="-5" y="-${f.len[2]}" rx="5" fill="#e2e8f0" stroke="#005fb8" stroke-width="0.8"/>
					</g>
				</g>
			</g>
		`);
		fingerLog.innerHTML += `<tr><td>${f.name}</td><td id="flex-${f.id}" class="val">--</td><td id="fsr-${f.id}" class="val">--</td></tr>`;
	});
	updateDateTime();
	setInterval(updateDateTime, 1000);
	resizeCharts();
	
	document.querySelectorAll('canvas').forEach(c => clearCanvas(c));
}

function handleSystemToggle() {
	if (!systemActive) {
		startSystem();
	} else {
		terminateSystem();
	}
}

function startSystem() {
	systemActive = true;
	const btn = document.getElementById('btn-monitor');
	btn.innerText = "Terminate System";
	btn.className = "btn btn-red";
	document.getElementById('btn-calibrate').disabled = false;
	document.getElementById('session-status').innerText = "LINK ESTABLISHED";
}

function terminateSystem() {
	systemActive = false;
	isSessionRunning = false;
	isCalibrating = false;

	clearInterval(sessionInterval);
	clearInterval(dataInterval);
	dataInterval = null;
	sessionSeconds = 0;
	
	const btn = document.getElementById('btn-monitor');
	btn.innerText = "Init Stream";
	btn.className = "btn btn-blue";
	
	document.getElementById('btn-calibrate').disabled = true;
	document.getElementById('btn-session').disabled = true;
	document.getElementById('btn-session').innerText = "Begin Session";
	document.getElementById('btn-session').className = "btn btn-green";

	document.getElementById('session-status').innerText = "SYSTEM OFFLINE";
	document.getElementById('grasp-label').innerText = "---";
	document.getElementById('sess-time').innerText = "00:00";
	
	flexHist = config.map(() => []);
	fsrHist = config.map(() => []);
	accXData = []; accYData = []; accZData = [];

	config.forEach(f => {
		document.getElementById(`flex-${f.id}`).innerText = "--";
		document.getElementById(`fsr-${f.id}`).innerText = "--";
	});
	document.getElementById('acc-x').innerText = "0.00";
	document.getElementById('acc-y').innerText = "0.00";
	document.getElementById('acc-z').innerText = "0.00";

	document.querySelectorAll('canvas').forEach(c => clearCanvas(c));
}

function startCalibration() {
	isCalibrating = true;
	document.getElementById('btn-calibrate').disabled = true;
	document.getElementById('session-status').innerText = "CALIBRATING...";
	document.getElementById('grasp-label').innerText = "DETECTING THRESHOLDS...";
	
	if(!dataInterval) dataInterval = setInterval(updateData, updateRate);
	
	setTimeout(() => {
		if(!systemActive) return;
		isCalibrating = false;
		document.getElementById('session-status').innerText = "SYSTEM READY";
		document.getElementById('grasp-label').innerText = "---";
		document.getElementById('btn-calibrate').disabled = false;
		document.getElementById('btn-session').disabled = false;
	}, 3000);
}

function toggleSession() {
	const btn = document.getElementById('btn-session');
	if (!isSessionRunning) {
		isSessionRunning = true;
		btn.innerText = "Stop Session";
		btn.className = "btn btn-red";
		document.getElementById('session-status').innerText = "RECORDING ACTIVE";
		sessionInterval = setInterval(() => {
			sessionSeconds++;
			document.getElementById('sess-time').innerText = 
				Math.floor(sessionSeconds/60).toString().padStart(2,'0') + ":" + (sessionSeconds%60).toString().padStart(2,'0');
		}, 1000);
	} else {
		isSessionRunning = false;
		btn.innerText = "Resume Session";
		btn.className = "btn btn-orange";
		document.getElementById('session-status').innerText = "DATA FROZEN";
		clearInterval(sessionInterval);
		document.getElementById('grasp-label').innerText = "---";
	}
}

function classifyMovement(avgFlx, avgFsr) {
	for (const [name, thresholds] of Object.entries(grasps)) {
		if (avgFlx >= thresholds.flx[0] && avgFlx <= thresholds.flx[1] &&
			avgFsr >= thresholds.fsr[0] && avgFsr <= thresholds.fsr[1]) {
			return name.replace('_', ' ');
		}
	}
	return "Unknown Movement";
}

function updateData() {
	if (!isCalibrating && !isSessionRunning) return;

	const ax = (Math.random() * 2 - 1), ay = (Math.random() * 2 - 1), az = (9.81 + (Math.random() * 0.4 - 0.2));
	document.getElementById('acc-x').innerText = ax.toFixed(2);
	document.getElementById('acc-y').innerText = ay.toFixed(2);
	document.getElementById('acc-z').innerText = az.toFixed(2);

	let totalFlx = 0, totalFsr = 0;
	config.forEach((f, i) => {
		const flx = Math.floor(Math.random() * 100);
		const fsr = Math.floor(Math.random() * 100);
		document.getElementById(`flex-${f.id}`).innerText = flx + "%";
		document.getElementById(`fsr-${f.id}`).innerText = fsr + "%";
		
		flexHist[i].push(flx);
		fsrHist[i].push(fsr);
		if(flexHist[i].length > historyLimit) {
			flexHist[i].shift();
			fsrHist[i].shift();
		}

		totalFlx += flx; totalFsr += fsr;
	});

	const avgFlx = totalFlx / 5;
	const avgFsr = totalFsr / 5;

	if (isSessionRunning) {
		document.getElementById('grasp-label').innerText = classifyMovement(avgFlx, avgFsr);
	}

	accXData.push(ax); accYData.push(ay); accZData.push(az);
	if(accXData.length > historyLimit) {
		accXData.shift(); accYData.shift(); accZData.shift();
	}

	drawPlot('chart-flex', flexHist, digitColors, 0, 100);
	drawPlot('chart-fsr', fsrHist, digitColors, 0, 100);
	drawPlot('chart-imu', [accXData, accYData, accZData], ['#ff3333', '#33ff33', '#3399ff'], -5, 15);
}

function clearCanvas(canvas) {
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#1a1a1a';
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	
	ctx.strokeStyle = '#333333';
	ctx.lineWidth = 0.5;
	for(let i=0; i<canvas.width; i+=20) { ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,canvas.height); ctx.stroke(); }
	for(let i=0; i<canvas.height; i+=20) { ctx.beginPath(); ctx.moveTo(0,i); ctx.lineTo(canvas.width,i); ctx.stroke(); }
}

function drawPlot(canvasId, dataArrays, colors, minVal, maxVal) {
	const canvas = document.getElementById(canvasId);
	if (!canvas) return;
	const ctx = canvas.getContext('2d');
	
	clearCanvas(canvas);

	dataArrays.forEach((data, idx) => {
		if (data.length < 2) return;
		ctx.beginPath(); 
		ctx.strokeStyle = colors[idx]; 
		ctx.lineWidth = 2;
		ctx.lineJoin = 'round';
		
		data.forEach((val, i) => {
			const x = (i / (historyLimit-1)) * canvas.width;
			const y = canvas.height - ((val - minVal) / (maxVal - minVal)) * canvas.height;
			if(i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
		});
		ctx.stroke();
	});
}

function resizeCharts() {
	['chart-flex', 'chart-fsr', 'chart-imu'].forEach(id => {
		const canvas = document.getElementById(id);
		if(canvas) {
			canvas.width = canvas.clientWidth;
			canvas.height = canvas.clientHeight;
		}
	});
}

function updateDateTime() {
	const now = new Date();
	document.getElementById('curr-date').innerText = now.toLocaleDateString();
	document.getElementById('curr-time').innerText = now.toLocaleTimeString();
}

window.onload = init;
window.onresize = resizeCharts;
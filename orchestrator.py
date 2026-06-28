from __future__ import annotations
import logging
import time
from threading import Event
from typing import Dict, Optional
from models import MovementData

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, config: Dict):
        self.config = config
        self.running = False
        self.stop_event = Event()
        self.current_session_id = None
        self.current_task = None
        self._latest_sensor_data = {} 
        self._latest_ml_result = {}
        self._session_live_grasp: Optional[str] = None
        self._session_target_grasp: Optional[str] = None

        # ── Per-session KPI accumulators (no DB required) ──────────
        self._session_start_time: Optional[float] = None
        self._session_correct_frames: int = 0
        self._session_total_frames: int = 0
        self._session_haptic_on_frames: int = 0
        
        logger.info("Initializing communicator…")
        from communicator import ESPCommunicator
        self.comm = ESPCommunicator(
            serial_port=config.get("serial_port", "/dev/ttyUSB0"),
            baud_rate=config.get("baud_rate", 115200)
        )

        logger.info("Initializing ML inference…")
        from ml_inference import MLInference
        self.ml_inference = MLInference()

        logger.info("Initializing Session Manager & Database…")
        from session_manager import SessionManager
        from database_layer import DatabaseLayer
        self.session_manager = SessionManager(config)
        self.database = DatabaseLayer(config.get("postgres", {}))

    @property
    def ble_connected(self) -> bool:
        return getattr(self.comm, 'ble_connected', False)

    def get_latest_sensor_data(self) -> Dict:
        return self._latest_sensor_data

    def get_latest_ml_result(self) -> Dict:
        return self._latest_ml_result
        
    def calibrate_sensors(self) -> Dict:
        logger.info("Sending CALIBRATE command to hardware...")
        if hasattr(self.comm, 'send_command'):
            self.comm.send_command("CALIBRATE")
        return {"status": "calibration_command_sent"}
    
    def _send_haptic_all(self, pwm: int) -> None:
        if not hasattr(self, 'comm') or not self.comm:
            return

        pwm_val = max(0, min(255, int(pwm)))
        
        for finger_idx in range(5):
            haptic_cmd = f"HAPTIC:{finger_idx}:{pwm_val}\n"
            self.comm.send_command(haptic_cmd)

    def update_session_haptic_feedback(self, live_grasp: str, target_grasp: str) -> None:

        if not self.current_session_id:
            return

        # Normalize text variations (e.g. "open_grip" vs "Open_Grip" or spaces)
        clean_live = str(live_grasp).strip().lower().replace(" ", "_")
        clean_target = str(target_grasp).strip().lower().replace(" ", "_")

        # If the user's hand pose doesn't match the therapy target task -> trigger alert vibration
        if clean_live != clean_target:
            self._send_haptic_all(150)
        else:
            self._send_haptic_all(0)

    def get_sampling_rate(self) -> float:
        return 20.0
        
    def get_buffer_size(self) -> int:
        if hasattr(self.comm, 'get_incoming_fps'):
            return self.comm.get_incoming_fps()
        return 0

    def run(self) -> None:
        self.running = True
        logger.info("Orchestrator background thread started.")
        
        while self.running:
            if not self.comm.ble_connected and not self.comm.ser:
                time.sleep(0.1) 
                continue

            try:
                result = self.comm.get_latest_reading()
                if result and "sensors" in result:
                    raw_sensors = result["sensors"]

                    ml_result = self.ml_inference.predict(
                        raw_sensors=raw_sensors, 
                        target_task=self.current_task 
                    )
                    self._latest_ml_result = ml_result
                    self._latest_sensor_data = result

                    active_grasp = ml_result.get("classification")

                    if self.current_session_id and self.current_task:
                        self._session_total_frames += 1

                        if active_grasp != self.current_task:
                            self._session_haptic_on_frames += 1
                            # self._send_haptic_all(150) 
                        else:
                            self._session_correct_frames += 1
                            # self._send_haptic_all(0)

                time.sleep(0.005) 

            except Exception as e:
                logger.error(f"Error in Orchestrator loop: {e}")
                time.sleep(0.1)
                
        logger.info("Orchestrator thread exiting.")

    def start_session(self, patient_id, task_type: str) -> str:
        if self.current_session_id:
            self.end_session()

        # Reset per-session KPI accumulators
        self._session_start_time = time.time()
        self._session_correct_frames = 0
        self._session_total_frames = 0
        self._session_haptic_on_frames = 0

        # Try DB-backed session; fall back to a temp ID if DB is unavailable
        try:
            session_id = self.session_manager.start(patient_id, task_type)
        except Exception as exc:
            logger.warning("SessionManager unavailable (%s) — using temporary session ID", exc)
            session_id = f"TEMP-{patient_id}-{int(time.time())}"

        self.current_session_id = session_id
        self.current_task = task_type
        logger.info(f"Session {session_id} started (Task: {task_type})")
        return session_id

    def end_session(self) -> Optional[Dict]:
        if not self.current_session_id:
            return None

        # ── Compute KPIs from accumulators ─────────────────────────
        self._send_haptic_all(0)
        duration = time.time() - self._session_start_time if self._session_start_time else 0
        total    = max(self._session_total_frames, 1)   # avoid /0
        correct  = self._session_correct_frames
        haptic   = self._session_haptic_on_frames

        # Approximate real-time seconds (loop sleeps ~5 ms between frames)
        frame_dt = duration / total if total else 0.005
        accuracy       = correct / total * 100
        haptic_pct     = haptic  / total * 100
        correct_time_s = correct * frame_dt
        error_time_s   = haptic  * frame_dt

        metrics: Dict = {
            "session_id":         self.current_session_id,
            "target_grasp":       self.current_task,
            "duration_seconds":   round(duration, 1),
            "total_frames":       self._session_total_frames,
            "correct_frames":     correct,
            "accuracy_pct":       round(accuracy, 1),
            "correct_duration_s": round(correct_time_s, 1),
            "error_duration_s":   round(error_time_s, 1),
            "haptic_trigger_pct": round(haptic_pct, 1),
            "haptic_on_frames":   haptic,
        }

        # ── Optional DB flush (skip gracefully if unavailable) ──────
        try:
            self.database._flush_to_db()
            db_metrics = self.session_manager.stop(self.current_session_id)
            if db_metrics:
                metrics.update(db_metrics)
            self.database.update_session_metrics(self.current_session_id, metrics)
        except Exception as exc:
            logger.warning("DB metrics save skipped (%s) — metrics computed locally", exc)

        logger.info(
            "Session %s ended — duration=%.0fs, accuracy=%.1f%%, haptic=%.1f%%",
            self.current_session_id, duration, accuracy, haptic_pct
        )

        self.current_session_id     = None
        self.current_task           = None
        self._session_start_time    = None

        if hasattr(self.comm, 'send_command'):
            self.comm.send_command("HAPTIC:0\n")

        return metrics

    def stop(self) -> None:
        self.running = False
        self.stop_event.set()
        if self.current_session_id:
            self.end_session()
        try:
            if hasattr(self.comm, 'send_command'):
                self.comm.send_command("HAPTIC:0\n")
            self.comm.disconnect()
        except Exception:
            pass
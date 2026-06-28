import uuid
import logging
import numpy as np
from datetime import datetime

logger = logging.getLogger(__name__)

class SessionManager:
    def __init__(self, config):
        self.config = config
        self.sessions = {}
    
    def start(self, patient_id, task_type):
        session_id = str(uuid.uuid4())[:8]
        
        self.sessions[session_id] = {
            'patient_id': patient_id,
            'task_type': task_type,
            'start_time': datetime.now(),
            'end_time': None,
            'movements': [],
            'metrics': None
        }
        
        logger.info(f"Session started: {session_id} (Patient: {patient_id}, Task: {task_type})")
        return session_id
    
    def record_movement(self, session_id, sensor_data, ml_result, haptic_intensity):
        if session_id not in self.sessions:
            logger.error(f"Unknown session: {session_id}")
            return
        
        movement = {
            'timestamp': datetime.now().timestamp(),
            'sensor_values': sensor_data,
            'error': ml_result.get('deviation', 0.0) if ml_result else 0.0,
            'haptic_intensity': haptic_intensity
        }
        
        self.sessions[session_id]['movements'].append(movement)
    
    def stop(self, session_id):
        if session_id not in self.sessions:
            logger.error(f"Cannot stop unknown session: {session_id}")
            return None
            
        session = self.sessions[session_id]
        session['end_time'] = datetime.now()
        
        metrics = self._calculate_metrics(session)
        session['metrics'] = metrics
        
        logger.info(f"Session completed: {session_id}")
        logger.info(f"  Duration: {metrics['duration_seconds']:.1f}s")
        logger.info(f"  Mean Deviation: {metrics['mean_error']:.2f}")
        logger.info(f"  Peak Deviation: {metrics['peak_error']:.2f}")
        logger.info(f"  Smoothness: {metrics['smoothness']:.2f}")
        
        return metrics
    
    def _calculate_metrics(self, session):
        movements = session['movements']
        
        if len(movements) == 0:
            return {
                'duration_seconds': 0,
                'movement_count': 0,
                'mean_error': 0.0,
                'peak_error': 0.0,
                'rms_error': 0.0,
                'smoothness': 0.0
            }
        
        duration = (session['end_time'] - session['start_time']).total_seconds()
        errors = np.array([m['error'] for m in movements])
        mean_error = float(np.mean(errors))
        peak_error = float(np.max(errors))
        rms_error = float(np.sqrt(np.mean(np.square(errors))))

        error_diffs = np.diff(errors)
        smoothness = float(1.0 / (1.0 + np.std(error_diffs))) if len(error_diffs) > 0 else 0.0
        
        return {
            'duration_seconds': duration,
            'movement_count': len(movements),
            'mean_error': mean_error,
            'peak_error': peak_error,
            'rms_error': rms_error,
            'smoothness': smoothness
        }

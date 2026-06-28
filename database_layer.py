import csv
import logging
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional
from sqlalchemy import create_engine, func
from sqlalchemy.orm import sessionmaker
from models import Base, Patient, Session, MovementData

logger = logging.getLogger(__name__)

class DatabaseLayer:
    def __init__(self, postgres_config: Dict, csv_dir: str = "./sessions"):
        self.postgres_config = postgres_config
        self.csv_dir = Path(csv_dir)
        self.csv_dir.mkdir(exist_ok=True)

        self.use_postgres  = False
        self.SessionLocal  = None
        self.engine        = None
        self.buffer: List[MovementData] = []
        self.buffer_limit  = 20
        
        user     = postgres_config.get("user",     "thesis_user")
        password = postgres_config.get("password", "thesis_password")
        host     = postgres_config.get("host",     "localhost")
        port     = postgres_config.get("port",     5432)
        db_name  = postgres_config.get("database", "thesis_db")

        db_url = f"postgresql://{user}:{password}@{host}:{port}/{db_name}"

        try:
            self.engine = create_engine(db_url, echo=False, pool_pre_ping=True)
            with self.engine.connect():
                pass
            self.SessionLocal = sessionmaker(bind=self.engine)
            Base.metadata.create_all(self.engine)
            self.use_postgres = True
            logger.info("PostgreSQL connected and schema verified.")
        except Exception as exc:
            logger.warning("PostgreSQL unavailable — using CSV fallback: %s", exc)
            self.use_postgres = False

    def log_movement(self, session_id: str, sensor_data: Dict,
                     error: float, haptic_intensity: int) -> None:
        self.add_to_batch(session_id, sensor_data, error, haptic_intensity)

    def add_to_batch(self, session_id: str, sensor_data: Dict,
                     error: float, haptic_intensity: int) -> None:
        if not self.use_postgres:
            self._log_csv(session_id, sensor_data, error, haptic_intensity)
            return

        movement = MovementData(
            session_id=session_id,
            timestamp=sensor_data.get("timestamp"),
            sensor_values={
                "angles": sensor_data.get("finger_angles", []),
                "forces": sensor_data.get("force_values", []),
            },
            error_magnitude=float(error),
            haptic_intensity=int(haptic_intensity),
        )
        self.buffer.append(movement)

        if len(self.buffer) >= self.buffer_limit:
            self._flush_to_db()

    def _flush_to_db(self) -> None:
        if not self.SessionLocal or not self.buffer:
            return

        db = self.SessionLocal()
        try:
            db.bulk_save_objects(self.buffer)
            db.commit()
            logger.info("Flushed %d movement frames to DB.", len(self.buffer))
            self.buffer = []
        except Exception as exc:
            db.rollback()
            logger.error("DB flush error: %s", exc)
            self.buffer = []
        finally:
            db.close()

    def _log_csv(self, session_id: str, sensor_data: Dict,
                 error: float, haptic_intensity: int) -> None:
        csv_file = self.csv_dir / f"{session_id}_movements.csv"
        write_header = not csv_file.exists()

        try:
            with open(csv_file, "a", newline="") as f:
                writer = csv.writer(f)
                if write_header:
                    writer.writerow(
                        ["timestamp", "angles", "forces", "error", "haptic"]
                    )
                writer.writerow([
                    sensor_data.get("timestamp"),
                    sensor_data.get("finger_angles"),
                    sensor_data.get("force_values"),
                    error,
                    haptic_intensity,
                ])
        except Exception as exc:
            logger.error("CSV write error: %s", exc)

    def get_movements(self, session_id: int, limit: int = 1000) -> List[Dict]:
        if not self.use_postgres or not self.SessionLocal:
            logger.warning("PostgreSQL not available — CSV retrieval not implemented.")
            return []

        db = self.SessionLocal()
        try:
            rows = (
                db.query(MovementData)
                .filter(MovementData.session_id == session_id)
                .order_by(MovementData.id)
                .limit(limit)
                .all()
            )
            return [
                {
                    "timestamp":       row.timestamp,
                    "finger_angles":   (row.sensor_values or {}).get("angles", []),
                    "force_values":    (row.sensor_values or {}).get("forces", []),
                    "error":           row.error_magnitude,
                    "haptic_intensity": row.haptic_intensity,
                }
                for row in rows
            ]
        except Exception as exc:
            logger.error("get_movements error: %s", exc)
            return []
        finally:
            db.close()
    
    def _movement_to_dict(self, m: MovementData) -> Dict:
        sensors = m.sensor_values or {}

        if "raw" in sensors:
            flex_vals = sensors["raw"][:5]
            fsr_vals = sensors["raw"][5:10]
        else:
            flex_vals = sensors.get("finger_angles", [0]*5)
            fsr_vals = sensors.get("force_values", [0]*5)
            
        return {
            "id":               m.id,
            "session_id":       m.session_id,
            "timestamp":        m.timestamp,
            "finger_angles":    flex_vals, 
            "force_values":     fsr_vals,
            "error_magnitude":  m.error_magnitude,
            "haptic_intensity": m.haptic_intensity,
        }

    def get_patients(self) -> List[Dict]:
        if not self.use_postgres or not self.SessionLocal:
            return []

        db = self.SessionLocal()
        try:
            patients = db.query(Patient).all() 
            return [self._patient_to_dict(p) for p in patients]
        except Exception as exc:
            logger.error("get_patients error: %s", exc)
            return []
        finally:
            db.close()

    def get_patient_by_id(self, patient_id: int) -> Optional[Dict]:
        if not self.use_postgres or not self.SessionLocal:
            return None

        db = self.SessionLocal()
        try:
            patient = db.query(Patient).filter(Patient.id == patient_id).first()
            return self._patient_to_dict(patient) if patient else None
        except Exception as exc:
            logger.error("get_patient_by_id error: %s", exc)
            return None
        finally:
            db.close()

    def create_patient(self, name: str, age: Optional[int] = None,
                       condition: Optional[str] = None,
                       rehabilitation_date: Optional[date] = None,
                       next_session_date: Optional[date] = None,
                       status: str = "Active") -> Optional[Dict]:
        if not self.use_postgres or not self.SessionLocal:
            logger.warning("Cannot create patient — PostgreSQL not available.")
            return None

        db = self.SessionLocal()
        try:
            patient = Patient(
                name=name,
                age=age,
                condition=condition,
                rehabilitation_date=rehabilitation_date,
                next_session_date=next_session_date,
                status=status,
            )
            db.add(patient)
            db.commit()
            db.refresh(patient)
            logger.info("Created patient id=%d name=%s", patient.id, patient.name)
            return self._patient_to_dict(patient)
        except Exception as exc:
            db.rollback()
            logger.error("create_patient error: %s", exc)
            return None
        finally:
            db.close()

    def get_all_sessions(self, patient_id: Optional[int] = None) -> List[Dict]:
        if not self.use_postgres or not self.SessionLocal:
            return []

        db = self.SessionLocal()
        try:
            query = db.query(Session, Patient.name).join(
                Patient, Session.patient_id == Patient.id
            )
            if patient_id is not None:
                query = query.filter(Session.patient_id == patient_id)
            rows = query.order_by(Session.start_time.desc()).all()
            return [self._session_to_dict(s, pname) for s, pname in rows]
        except Exception as exc:
            logger.error("get_all_sessions error: %s", exc)
            return []
        finally:
            db.close()

    def update_session_metrics(self, session_id: str, metrics: Dict) -> None:
        if not self.use_postgres or not self.SessionLocal:
            return

        db = self.SessionLocal()
        try:
            session = db.query(Session).filter(Session.id == session_id).first()
            if not session:
                logger.warning("update_session_metrics: session %s not found", session_id)
                return
            session.end_time         = datetime.utcnow()
            session.mean_error       = metrics.get("mean_error")
            session.peak_error       = metrics.get("peak_error")
            session.rms_error        = metrics.get("rms_error")
            session.smoothness       = metrics.get("smoothness")
            session.duration_seconds = metrics.get("duration_seconds")
            session.movement_count   = metrics.get("movement_count")
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.error("update_session_metrics error: %s", exc)
        finally:
            db.close()

    def get_dashboard_stats(self) -> Dict:
        if not self.use_postgres or not self.SessionLocal:
            return {
                "active_patients":    0,
                "total_sessions":     0,
                "upcoming_sessions":  0,
                "current_year":       datetime.utcnow().year,
            }

        db = self.SessionLocal()
        try:
            today = date.today()
            active_patients   = db.query(func.count(Patient.id)).filter(
                Patient.status == "Active"
            ).scalar() or 0
            total_sessions    = db.query(func.count(Session.id)).scalar() or 0
            upcoming_sessions = db.query(func.count(Patient.id)).filter(
                Patient.next_session_date >= today
            ).scalar() or 0
            return {
                "active_patients":   active_patients,
                "total_sessions":    total_sessions,
                "upcoming_sessions": upcoming_sessions,
                "current_year":      today.year,
            }
        except Exception as exc:
            logger.error("get_dashboard_stats error: %s", exc)
            return {
                "active_patients": 0, "total_sessions": 0,
                "upcoming_sessions": 0, "current_year": datetime.utcnow().year,
            }
        finally:
            db.close()

    def _patient_to_dict(self, p: Patient) -> Dict:
        session_count = len(p.sessions) if p.sessions else 0
        return {
            "id":                 p.id,
            "name":               p.name,
            "age":                p.age,
            "condition":          p.condition,
            "rehabilitation_date": str(p.rehabilitation_date) if p.rehabilitation_date else None,
            "next_session_date":  str(p.next_session_date)   if p.next_session_date   else None,
            "status":             p.status,
            "session_count":      session_count,
        }

    def _session_to_dict(self, s: Session, patient_name: Optional[str] = None) -> Dict:
        return {
            "id":               s.id,
            "patient_id":       s.patient_id,
            "patient_name":     patient_name,
            "task_type":        s.task_type,
            "start_time":       s.start_time.isoformat() if s.start_time else None,
            "end_time":         s.end_time.isoformat()   if s.end_time   else None,
            "mean_error":       s.mean_error,
            "peak_error":       s.peak_error,
            "rms_error":        s.rms_error,
            "smoothness":       s.smoothness,
            "duration_seconds": s.duration_seconds,
            "movement_count":   s.movement_count,
        }

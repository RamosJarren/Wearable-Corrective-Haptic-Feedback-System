from sqlalchemy import Column, Integer, Float, String, Date, DateTime, ForeignKey, JSON
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
import datetime

Base = declarative_base()

class Patient(Base):
    __tablename__ = 'patient'
    id = Column(Integer, primary_key=True)
    name = Column(String)
    age = Column(Integer, nullable=True)
    condition = Column(String)
    rehabilitation_date = Column(Date) 
    next_session_date = Column(Date)
    status = Column(String, default="Active")
    sessions = relationship("Session", back_populates="patient", cascade="all, delete-orphan")
 
class Session(Base):
    __tablename__ = "session"
    id               = Column(Integer,  primary_key=True, index=True)
    patient_id       = Column(Integer,  ForeignKey("patient.id"), nullable=False)
    task_type        = Column(String,   nullable=True)
    start_time       = Column(DateTime, default=datetime.datetime.utcnow)
    end_time         = Column(DateTime, nullable=True)
    mean_error       = Column(Float,   nullable=True)
    peak_error       = Column(Float,   nullable=True)
    rms_error        = Column(Float,   nullable=True)
    smoothness       = Column(Float,   nullable=True)
    duration_seconds = Column(Float,   nullable=True)
    movement_count   = Column(Integer, nullable=True)
    patient   = relationship("Patient",      back_populates="sessions")
    movements = relationship("MovementData", back_populates="session", cascade="all, delete-orphan")
 
class MovementData(Base):
    __tablename__ = "movement_data"
    id               = Column(Integer, primary_key=True, index=True)
    session_id       = Column(Integer, ForeignKey("session.id"), nullable=False)
    timestamp        = Column(Float,   nullable=True)
    sensor_values    = Column(JSON,    nullable=True)
    error_magnitude  = Column(Float,   nullable=True)
    haptic_intensity = Column(Integer, nullable=True)
    session = relationship("Session", back_populates="movements")

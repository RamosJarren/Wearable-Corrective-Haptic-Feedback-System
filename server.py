import logging
import os
import time
from datetime import date, datetime
from typing import Optional
from fastapi import FastAPI, HTTPException, APIRouter, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from contextlib import asynccontextmanager
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class PatientCreate(BaseModel):
    name: str
    age: Optional[int] = None
    condition: Optional[str] = None
    rehabilitation_date: Optional[str] = None 
    next_session_date: Optional[str] = None
    status: str = "Active"

class HapticEvalSchema(BaseModel):
    live_grasp: str
    target_grasp: str

def create_app(config, orchestrator):
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("FastAPI app started.")
        yield
        logger.info("FastAPI app shutting down.")
        orchestrator.stop()

    app = FastAPI(
        title="Wearable Haptic Feedback System",
        description="Real-time stroke rehabilitation feedback system",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    templates_dir = os.path.join(os.path.dirname(__file__), "templates")
    for sub in ("css", "js", "images", "fonts"):
        sub_path = os.path.join(templates_dir, sub)
        if os.path.exists(sub_path):
            app.mount(f"/{sub}", StaticFiles(directory=sub_path), name=sub)

    if os.path.exists("static"):
        app.mount("/static", StaticFiles(directory="static"), name="static")

    templates = Jinja2Templates(directory=templates_dir)

    def _page(template: str):
        async def handler(request: Request):
            return templates.TemplateResponse(request=request, name=template)
        handler.__name__ = template.replace(".", "_").replace("/", "_")
        return handler

    app.get("/",           response_class=HTMLResponse)(_page("home.html"))
    app.get("/home.html", response_class=HTMLResponse)(_page("home.html"))

    for page in (
        "dashboard.html", "patients.html", "sessions.html", "data visualization.html",
    ):
        app.get(f"/{page}", response_class=HTMLResponse)(_page(page))

    @app.get("/api/health")
    async def health_check():
        return {"status": "ok"}

    @app.get("/api/status")
    async def get_status():
        try:
            ml = orchestrator.get_latest_ml_result()
            return {
                "status": "success",
                "ble_connected": getattr(orchestrator, 'ble_connected', False),
                "sampling_rate": getattr(orchestrator, 'get_sampling_rate', lambda: 20.0)(),
                "active_session": orchestrator.current_session_id is not None,
                "buffer_size": getattr(orchestrator, 'get_buffer_size', lambda: 0)(), 
                "ml_confidence": ml.get("confidence", 0.0) if ml else 0.0,
            }
        except Exception as exc:
            logger.error("Status error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @app.get("/api/data/current")
    async def get_current_data():
        data = orchestrator.get_latest_sensor_data()
        if not data:
            return {"status": "no_data"}

        ml = orchestrator.get_latest_ml_result()
        response = {**data}

        if ml:
            response["ml_feedback"] = {
                "classification": ml.get("classification"),
                "confidence":     ml.get("confidence", 0.0), 
                "error_pct":      ml.get("error_pct", 0.0),  
                "pwm_intensity":  ml.get("pwm_intensity", 0),
                "distances":      ml.get("distances", {}),  
            }

        return response

    @app.post("/api/calibrate")
    async def calibrate():
        try:
            orchestrator.calibrate_sensors()
            return {"status": "success", "message": "Sensor calibration complete"}
        except Exception as exc:
            logger.error("Calibration error: %s", exc)
            raise HTTPException(status_code=400, detail=str(exc))

    @app.post("/api/sessions/start")
    async def start_session(patient_id: str, task_type: str):
        try:
            # Convert to int if it looks numeric; keep as-is for TEMP IDs
            pid: any = int(patient_id) if patient_id.isdigit() else patient_id
            session_id = orchestrator.start_session(pid, task_type)
            return {"status": "success", "session_id": session_id}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @app.post("/api/sessions/stop")
    async def stop_session():
        try:
            metrics = orchestrator.end_session()
            return {"status": "success", "metrics": metrics}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))
 
    @app.get("/api/dashboard/stats")
    async def get_dashboard_stats():
        try:
            stats = orchestrator.database.get_dashboard_stats()
            return {"status": "success", "stats": stats}
        except Exception as exc:
            logger.error("Dashboard stats error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @app.get("/api/patients")
    async def list_patients():
        try:
            patients = orchestrator.database.get_patients()
            return {"status": "success", "patients": patients, "count": len(patients)}
        except Exception as exc:
            logger.error("List patients error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @app.get("/api/patients/{patient_id}")
    async def get_patient(patient_id: int):
        try:
            patient = orchestrator.database.get_patient_by_id(patient_id)
            if patient is None:
                raise HTTPException(status_code=404, detail="Patient not found")
            return {"status": "success", "patient": patient}
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Get patient error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @app.post("/api/patients")
    async def create_patient(body: PatientCreate):
        try:
            rehab_date   = date.fromisoformat(body.rehabilitation_date) if body.rehabilitation_date else None
            next_session = date.fromisoformat(body.next_session_date)   if body.next_session_date   else None

            patient = orchestrator.database.create_patient(
                name=body.name,
                age=body.age,
                condition=body.condition,
                rehabilitation_date=rehab_date,
                next_session_date=next_session,
                status=body.status,
            )
            if patient is None:
                raise HTTPException(status_code=503, detail="Database unavailable")
            return {"status": "success", "patient": patient}
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("Create patient error: %s", exc)
            raise HTTPException(status_code=400, detail=str(exc))

    @app.get("/api/sessions")
    async def list_sessions(patient_id: Optional[int] = Query(None)):
        try:
            sessions = orchestrator.database.get_all_sessions(patient_id=patient_id)
            return {"status": "success", "sessions": sessions, "count": len(sessions)}
        except Exception as exc:
            logger.error("List sessions error: %s", exc)
            raise HTTPException(status_code=500, detail=str(exc))

    @app.get("/api/sessions/{session_id}")
    async def get_session_movements(session_id: int, limit: int = 1000):
        try:
            movements = orchestrator.database.get_movements(session_id, limit)
            return {
                "status":         "success",
                "session_id":     session_id,
                "movement_count": len(movements),
                "movements":      movements,
            }
        except Exception as exc:
            logger.error("Session retrieval error: %s", exc)
            raise HTTPException(status_code=404, detail=str(exc))

    @app.post("/api/session/evaluate-haptic")
    async def evaluate_session_haptic(data: HapticEvalSchema):
        try:
            # Pass values directly to the active loop broker
            orchestrator.update_session_haptic_feedback(data.live_grasp, data.target_grasp)
            return {"status": "processed"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        logger.info("API REQUEST: %s %s", request.method, request.url)
        response = await call_next(request)
        return response

    return app

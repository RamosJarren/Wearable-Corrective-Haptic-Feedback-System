import logging
import socket
import time
import json
import sys
import os
import webbrowser
from threading import Thread

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

for logger_name in logging.root.manager.loggerDict:
    if "sqlalchemy" in logger_name or "uvicorn" in logger_name:
        logging.getLogger(logger_name).setLevel(logging.WARNING)

logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
logging.getLogger('sqlalchemy.pool').setLevel(logging.WARNING)

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
CONFIG_PATH = os.path.join(DATA_DIR, 'config.json')

def get_current_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))
        IP = s.getsockname()[0]
    except Exception:
        IP = '127.0.0.1'
    finally:
        s.close()
    return IP

def load_config():
    if not os.path.exists(CONFIG_PATH):
        logger.warning(f"Config file not found at {CONFIG_PATH}. Using internal defaults.")
        return {
            'server': {'port': 5000},
            'serial_port': '/dev/ttyUSB0',
            'baud_rate': 115200,
            'postgres': {
                'host': 'localhost',
                'port': 5432,
                'database': 'haptic_db',
                'user': 'haptic_user',
                'password': 'password'
            }
        }
    
    try:
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Error reading config: {e}")
        sys.exit(1)

if __name__ == "__main__":
    logger.info("=" * 75)
    logger.info("WEARABLE HAPTIC FEEDBACK SYSTEM")
    logger.info("=" * 75)
    
    config = load_config()
    logger.info("Configuration loaded")
    
    try:
        from orchestrator import Orchestrator
        from server import create_app
        
        logger.info("Initializing orchestrator...")
        orchestrator = Orchestrator(config)

        orch_thread = Thread(target=orchestrator.run, daemon=False)
        orch_thread.start()
        logger.info("Orchestrator started in background thread")
        
        time.sleep(1)  
        
        logger.info("Initializing FastAPI server...")
        app = create_app(config, orchestrator)
        port = config.get('server', {}).get('port', 5000)

        current_ip = get_current_ip()
        logger.info(f"Starting API server on http://0.0.0.0:{port}")
        logger.info(f"🌐 Access the dashboard on your laptop at: http://{current_ip}:{port}")
        logger.info(f"🌐 Or try mDNS: http://raspberrypi.local:{port}")

        def open_browser():
            time.sleep(2)
            webbrowser.open(f"http://127.0.0.1:{port}") 
        Thread(target=open_browser, daemon=True).start()

        import uvicorn
        uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
        logger.info("Press CTRL+C to stop")
        
    except KeyboardInterrupt:
        logger.info("Shutdown requested by user")
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)
    finally:
        logger.info("System stopped")

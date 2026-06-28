from __future__ import annotations
import asyncio
import logging
import queue
import threading
import time
import os
from collections import deque
from typing import Dict, Optional

import serial

logger = logging.getLogger(__name__)

_SERVICE_UUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
_CHAR_RX_UUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
_CHAR_TX_UUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

class ESPCommunicator:
    def __init__(
        self,
        serial_port: str = "/dev/ttyUSB0",
        baud_rate: int = 115200,
        ble_device_name: str = "Hand_Glove",
        ble_scan_timeout: float = 30.0,
        broker: str = "localhost",
    ):
        self._data_buf: deque[str] = deque(maxlen=100)
        self._fps_timestamps: list[float] = []
        self._current_fps: int = 0
        self._cmd_queue: queue.Queue[str] = queue.Queue()
        self.ble_connected: bool = False
        self._ble_device_name = ble_device_name
        self._ble_scan_timeout = ble_scan_timeout
        self._shutdown = threading.Event()
        self.ser: Optional[serial.Serial] = None 
        self._ble_loop = asyncio.new_event_loop()
        self._ble_thread = threading.Thread(
            target=self._run_ble_loop, name="BLE-Thread", daemon=True
        )

        try:
            self.ser = serial.Serial(serial_port, baud_rate, timeout=0.01)
            threading.Thread(
                target=self._serial_reader, name="Serial-Reader", daemon=True
            ).start()
            logger.info("Serial fallback active on %s @ %d baud", serial_port, baud_rate)
        except Exception as exc:
            logger.warning("Serial unavailable (%s) — BLE-only mode", exc)

        logger.info("BLE manager started — scanning for '%s'", ble_device_name)
        self._ble_thread.start()

    def _run_ble_loop(self) -> None:
        asyncio.set_event_loop(self._ble_loop)
        self._ble_loop.run_until_complete(self._ble_manager())

    async def _ble_manager(self) -> None:
        while not self._shutdown.is_set():
            if not self.ser or not self.ser.is_open:
                if os.path.exists("/dev/ttyUSB0"):
                    logger.info("New USB device detected! Attempting to switch to Serial...")
                    if self._attempt_serial_connection():
                        await asyncio.sleep(2) 
                        continue

            if not (self.ser and self.ser.is_open):
                try:
                    await self._connect_and_run()
                except Exception as exc:
                    if not self._shutdown.is_set():
                        logger.warning("BLE error: %s — retry in 5 s", exc)
                    self.ble_connected = False
                    await asyncio.sleep(5)
            else:
                await asyncio.sleep(1)

    async def _connect_and_run(self) -> None:
        try:
            from bleak import BleakClient, BleakScanner
        except ImportError:
            logger.error(
            )
            await asyncio.sleep(30)
            return

        logger.info("BLE scan starting (timeout=%.0f s)…", self._ble_scan_timeout)
        device = await BleakScanner.find_device_by_name(
            self._ble_device_name, timeout=self._ble_scan_timeout
        )
        if device is None:
            raise RuntimeError(
                f"BLE device '{self._ble_device_name}' not found — "
                "ensure ESP32 is powered, advertising, and in range"
            )

        logger.info("Found %s [%s], connecting…", device.name, device.address)

        async with BleakClient(
            device, disconnected_callback=self._on_ble_disconnect
        ) as client:
            self.ble_connected = True
            logger.info("BLE connected to %s", device.address)
            await client.start_notify(_CHAR_TX_UUID, self._ble_notification_handler)
            logger.info("BLE notifications active (TX char)")

            while client.is_connected and not self._shutdown.is_set():
                try:
                    cmd = self._cmd_queue.get_nowait()
                    payload = (cmd + "\n").encode("utf-8")
                    await client.write_gatt_char(_CHAR_RX_UUID, payload, response=False)
                    logger.debug("BLE → ESP32: %s", cmd)
                except queue.Empty:
                    pass
                await asyncio.sleep(0.001)

        self.ble_connected = False
        logger.info("BLE session closed")

    def _on_ble_disconnect(self, client) -> None:
        logger.warning("BLE device disconnected")
        self.ble_connected = False

    def _ble_notification_handler(self, sender, data):
        payload = data.decode("utf-8").strip()

        if payload.startswith("CALIB") or payload.startswith("PHASE"):
            return

        if payload:
            self._data_buf.append(payload)
            self._record_packet_arrival()

    def _serial_reader(self):
        logger.info("Serial reader thread started.")
        while not self._shutdown.is_set():
            if self.ser and self.ser.is_open:
                try:
                    if self.ser.in_waiting:
                        line = self.ser.readline().decode('utf-8').strip()

                        if line.startswith("CALIB") or line.startswith("PHASE"):
                            continue

                        if line:
                            self._data_buf.append(line)
                            self._record_packet_arrival()
                    else:
                        time.sleep(0.005)
                except Exception as e:
                    logger.debug(f"Serial read error: {e}")
                    time.sleep(1)
            else:
                time.sleep(0.1)

    def get_latest_reading(self) -> Optional[Dict]:
        if not self._data_buf:
            return None
        
        try:
            raw_line = self._data_buf[-1] 
            parts = [float(x.strip()) for x in raw_line.split(',') if x.strip()]
            
            if len(parts) >= 10:
                return {
                    "sensors": parts[:10],
                    "imu": parts[10:] if len(parts) > 10 else [],
                    "timestamp": time.time()
                }
        except (ValueError, IndexError) as e:
            return None
        except Exception as e:
            logger.error(f"Error parsing data line: {e}")
            
        return None

    def send_command(self, command: str) -> None:
        dispatched = False

        if self.ble_connected:
            self._cmd_queue.put(command)
            dispatched = True

        if self.ser and self.ser.is_open:
            try:
                self.ser.write((command + "\n").encode("utf-8"))
                dispatched = True
            except Exception as exc:
                logger.error("Serial disconnected: %s", exc)
                self.ser.close()
                self.ser = None

        if not dispatched:
            logger.warning(
                "Command not dispatched (no transport available): %s", command
            )

    def _attempt_serial_connection(self) -> bool:
        try:
            self.ser = serial.Serial("/dev/ttyUSB0", 115200, timeout=0.1)
            threading.Thread(
                target=self._serial_reader, name="Serial-Reader", daemon=True
            ).start()
            
            logger.info("Serial connection established successfully on /dev/ttyUSB0")
            return True
        except Exception as e:
            logger.debug("Failed to initialize detected serial port: %s", e)
            self.ser = None
            return False
        
    def _record_packet_arrival(self) -> None:
        now = time.time()
        self._fps_timestamps.append(now)
        self._fps_timestamps = [t for t in self._fps_timestamps if now - t <= 1.0]
        self._current_fps = len(self._fps_timestamps)

    def get_buffer_size(self) -> int:
        if not self.ble_connected and self.ser is None:
            return 0

        now = time.time()
        self._fps_timestamps = [t for t in self._fps_timestamps if now - t <= 1.0]
        self._current_fps = len(self._fps_timestamps)
        
        return self._current_fps

    def connect(self):
        serial_success = self._attempt_serial_connection()
    
        if serial_success:
            logger.info(f"UART Serial connected. Disabling BLE to save power.")
            self.use_ble = False
            if hasattr(self, 'ble_manager') and self.ble_manager:
                self.ble_manager.stop_scan()
            return

        if not serial_success:
            logger.warning("Serial port not found. Initiating BLE scan...")
            self.use_ble = True
            if hasattr(self, '_start_ble_connection'):
                self._start_ble_connection()

    def disconnect(self) -> None:
        self._shutdown.set()
        if self.ser and self.ser.is_open:
            try:
                self.ser.close()
            except Exception:
                pass
        logger.info("ESPCommunicator disconnected")

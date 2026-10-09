import json
import subprocess
import sys
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from scripts.simulate_sensors import (
    TEMPERATURE_THRESHOLD_C,
    VIBRATION_THRESHOLD_G,
    generate_live_sample,
)

root = Path(__file__).resolve().parent
incident_file = root / "data" / "incidents.json"


class ProjectRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0] != "/api/sensors/sample":
            super().do_GET()
            return

        with sample_lock:
            samples = list(live_samples)
            sample_count = live_sample_count
            incidents_today = sum(
                incident["date"] == datetime.now().astimezone().date().isoformat()
                for incident in incidents
            )
        if not samples:
            self.send_error(503, "Leitura dos sensores ainda não disponível")
            return

        response = json.dumps({
            "samples": samples,
            "total_samples": sample_count,
            "incidents_today": incidents_today,
        }).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


sample_lock = threading.Lock()
live_samples = deque(maxlen=60)
live_sample_count = 0
incidents = []
incident_condition_active = False


def load_incidents() -> list[dict]:
    if not incident_file.exists():
        return []

    payload = json.loads(incident_file.read_text(encoding="utf-8"))
    if not isinstance(payload, list) or not all(
        isinstance(incident, dict)
        and isinstance(incident.get("date"), str)
        and isinstance(incident.get("timestamp"), str)
        for incident in payload
    ):
        raise ValueError(f"Formato inválido no arquivo de incidentes: {incident_file}")

    today = datetime.now().astimezone().date().isoformat()
    return [incident for incident in payload if incident["date"] == today]


def save_incidents() -> None:
    temporary_file = incident_file.with_suffix(".tmp")
    temporary_file.write_text(json.dumps(incidents, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary_file.replace(incident_file)


def generate_samples(stop_event: threading.Event) -> None:
    global incident_condition_active, live_sample_count

    sample_index = 0
    next_sample_at = time.monotonic()
    while not stop_event.is_set():
        temperature, vibration = generate_live_sample(sample_index)
        recorded_at = datetime.now().astimezone()
        timestamp = recorded_at.isoformat(timespec="seconds")
        incident_active = (
            temperature > TEMPERATURE_THRESHOLD_C and vibration > VIBRATION_THRESHOLD_G
        )
        with sample_lock:
            if incident_active and not incident_condition_active:
                incidents.append({
                    "date": recorded_at.date().isoformat(),
                    "timestamp": timestamp,
                    "temperature": temperature,
                    "vibration": vibration,
                })
                save_incidents()
            incident_condition_active = incident_active
            live_samples.append({
                "sequence": live_sample_count,
                "timestamp": timestamp,
                "temperature": temperature,
                "vibration": vibration,
                "temperature_threshold": TEMPERATURE_THRESHOLD_C,
                "vibration_threshold": VIBRATION_THRESHOLD_G,
            })
            live_sample_count += 1

        sample_index += 1
        next_sample_at += 1.0
        stop_event.wait(max(0, next_sample_at - time.monotonic()))


def main() -> None:
    global incident_condition_active, incidents, live_sample_count

    print("Gerando dados dos sensores...")
    subprocess.run([sys.executable, str(root / "scripts" / "simulate_sensors.py")], check=True)

    historical_data = json.loads((root / "data" / "sensor_data.json").read_text(encoding="utf-8"))
    temperature = historical_data["temperature"]
    vibration = historical_data["vibration"]
    history_size = min(60, len(temperature["values"]), len(vibration["values"]))
    incidents = load_incidents()
    if history_size:
        incident_condition_active = (
            temperature["values"][-1] > temperature["threshold"]
            and vibration["values"][-1] > vibration["threshold"]
        )
    with sample_lock:
        live_sample_count = max(len(temperature["values"]), len(vibration["values"]))
        live_samples.extend(
            {
                "sequence": live_sample_count - history_size + offset,
                "timestamp": timestamp,
                "temperature": temperature_value,
                "vibration": vibration_value,
                "temperature_threshold": temperature["threshold"],
                "vibration_threshold": vibration["threshold"],
            }
            for offset, (timestamp, temperature_value, vibration_value) in enumerate(zip(
                temperature["timestamps"][-history_size:],
                temperature["values"][-history_size:],
                vibration["values"][-history_size:],
            ))
        )

    print("Iniciando servidor local...")
    server = ThreadingHTTPServer(("localhost", 8000), ProjectRequestHandler)
    stop_event = threading.Event()
    sampler = threading.Thread(target=generate_samples, args=(stop_event,), daemon=True)
    sampler.start()
    webbrowser.open("http://localhost:8000/")

    print("Projeto rodando em: http://localhost:8000/")
    print("Pressione Ctrl+C para encerrar.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor...")
    finally:
        stop_event.set()
        sampler.join(timeout=1)
        server.server_close()


if __name__ == "__main__":
    main()

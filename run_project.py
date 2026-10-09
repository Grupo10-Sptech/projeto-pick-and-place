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
        if not samples:
            self.send_error(503, "Leitura dos sensores ainda não disponível")
            return

        response = json.dumps({"samples": samples, "total_samples": sample_count}).encode("utf-8")

        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


sample_lock = threading.Lock()
live_samples = deque(maxlen=60)
live_sample_count = 0


def generate_samples(stop_event: threading.Event) -> None:
    global live_sample_count

    sample_index = 0
    next_sample_at = time.monotonic()
    while not stop_event.is_set():
        temperature, vibration = generate_live_sample(sample_index)
        with sample_lock:
            live_samples.append({
                "sequence": live_sample_count,
                "timestamp": datetime.now().astimezone().isoformat(timespec="seconds"),
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
    global live_sample_count

    print("Gerando dados dos sensores...")
    subprocess.run([sys.executable, str(root / "scripts" / "simulate_sensors.py")], check=True)

    historical_data = json.loads((root / "data" / "sensor_data.json").read_text(encoding="utf-8"))
    temperature = historical_data["temperature"]
    vibration = historical_data["vibration"]
    history_size = min(60, len(temperature["values"]), len(vibration["values"]))
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

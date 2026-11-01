
import json
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import paho.mqtt.client as mqtt

from scripts.simulate_sensors import (
    TEMPERATURE_THRESHOLD_C,
    VIBRATION_THRESHOLD_G,
    generate_live_sample,
)

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
INCIDENT_FILE = DATA_DIR / "incidents.json"

MQTT_HOST = "127.0.0.1"
MQTT_PORT = 1883
MQTT_TOPIC = "projeto-iot/sensores/pick-and-place-01"

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8000

sample_lock = threading.Lock()
live_samples = deque(maxlen=60)
live_sample_count = 0
incidents = []
incident_condition_active = False


class ProjectRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

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
            today = datetime.now().astimezone().date().isoformat()
            incidents_today = sum(
                incident["date"] == today for incident in incidents
            )

        if not samples:
            self.send_error(503, "Leituras dos sensores ainda não disponíveis")
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


def load_incidents():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    if not INCIDENT_FILE.exists():
        return []

    payload = json.loads(INCIDENT_FILE.read_text(encoding="utf-8"))

    if not isinstance(payload, list):
        raise ValueError("Formato inválido no arquivo de incidentes.")

    today = datetime.now().astimezone().date().isoformat()

    return [
        incident for incident in payload
        if isinstance(incident, dict)
        and incident.get("date") == today
        and isinstance(incident.get("timestamp"), str)
    ]


def save_incidents():
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    temporary_file = INCIDENT_FILE.with_suffix(".tmp")
    temporary_file.write_text(
        json.dumps(incidents, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
    temporary_file.replace(INCIDENT_FILE)


def load_historical_samples():
    """Carrega o histórico existente, sem executar o simulador CLI."""
    global live_sample_count, incident_condition_active

    history_file = DATA_DIR / "sensor_data.json"

    if not history_file.exists():
        return

    try:
        history = json.loads(history_file.read_text(encoding="utf-8"))
        temperature = history["temperature"]
        vibration = history["vibration"]

        rows = list(zip(
            temperature["timestamps"],
            temperature["values"],
            vibration["values"],
        ))[-60:]

        with sample_lock:
            for timestamp, temp_value, vib_value in rows:
                live_samples.append({
                    "sequence": live_sample_count,
                    "timestamp": timestamp,
                    "temperature": temp_value,
                    "vibration": vib_value,
                    "temperature_threshold": TEMPERATURE_THRESHOLD_C,
                    "vibration_threshold": VIBRATION_THRESHOLD_G,
                })
                live_sample_count += 1

            if rows:
                last_temp = rows[-1][1]
                last_vib = rows[-1][2]
                incident_condition_active = (
                    last_temp > TEMPERATURE_THRESHOLD_C
                    and last_vib > VIBRATION_THRESHOLD_G
                )

        print(f"Histórico carregado: {len(rows)} leituras.")

    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"Aviso: não foi possível carregar o histórico: {error}")


def generate_samples(stop_event, mqtt_client):
    global incident_condition_active, live_sample_count

    sample_index = 0
    next_sample_at = time.monotonic()

    while not stop_event.is_set():
        temperature, vibration = generate_live_sample(sample_index)

        recorded_at = datetime.now().astimezone()
        timestamp = recorded_at.isoformat(timespec="seconds")

        incident_active = (
            temperature > TEMPERATURE_THRESHOLD_C
            or vibration > VIBRATION_THRESHOLD_G
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

            sample = {
                "sequence": live_sample_count,
                "timestamp": timestamp,
                "temperature": temperature,
                "vibration": vibration,
                "temperature_threshold": TEMPERATURE_THRESHOLD_C,
                "vibration_threshold": VIBRATION_THRESHOLD_G,
            }

            live_samples.append(sample)
            live_sample_count += 1

        payload = json.dumps(sample, ensure_ascii=False)

        try:
            result = mqtt_client.publish(
                MQTT_TOPIC,
                payload=payload,
                qos=1,
                retain=False,
            )

            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                print(f"Falha ao publicar MQTT. Código: {result.rc}")

        except Exception as error:
            print(f"Erro na publicação MQTT: {error}")

        print(
            f"Leitura {sample['sequence']}: "
            f"temperatura={temperature} °C, "
            f"vibração={vibration} g"
        )

        sample_index += 1
        next_sample_at += 1.0
        stop_event.wait(max(0, next_sample_at - time.monotonic()))


def main():
    global incidents

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    incidents = load_incidents()
    load_historical_samples()

    mqtt_client = mqtt.Client(
        client_id="pick-and-place-simulator"
    )

    print(f"Conectando ao MQTT em {MQTT_HOST}:{MQTT_PORT}...")
    mqtt_client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    mqtt_client.loop_start()

    stop_event = threading.Event()
    sampler = threading.Thread(
        target=generate_samples,
        args=(stop_event, mqtt_client),
        daemon=True,
    )

    server = ThreadingHTTPServer(
        (HTTP_HOST, HTTP_PORT),
        ProjectRequestHandler,
    )

    sampler.start()

    print(f"MQTT conectado. Tópico: {MQTT_TOPIC}")
    print(f"Dashboard: http://localhost:{HTTP_PORT}/")
    print("Pressione Ctrl+C para encerrar.")

    # Abre automaticamente apenas se houver ambiente gráfico.
    try:
        webbrowser.open(f"http://localhost:{HTTP_PORT}/")
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando o projeto...")
    finally:
        stop_event.set()
        sampler.join(timeout=3)
        server.server_close()
        mqtt_client.disconnect()
        mqtt_client.loop_stop()
        print("Projeto encerrado.")


if __name__ == "__main__":
    main()

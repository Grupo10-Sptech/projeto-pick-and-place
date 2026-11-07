from management_api import get_management_data

import json
import os
import threading
import time
import webbrowser
from collections import deque
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient

from scripts.simulate_sensors import (
    TEMPERATURE_THRESHOLD_C,
    VIBRATION_THRESHOLD_G,
    generate_live_sample,
)

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"

MQTT_HOST = "127.0.0.1"
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC = "projeto-iot/sensores/pick-and-place-01"

INFLUX_URL = "http://127.0.0.1:8086"
INFLUX_ORG = "projeto-iot"
INFLUX_BUCKET = "sensores"

HTTP_HOST = "0.0.0.0"
HTTP_PORT = 8000

sample_lock = threading.Lock()
live_samples = deque(maxlen=60)
live_sample_count = 0


class ProjectRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, payload, status=200):
        response = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_GET(self):
        route = self.path.split("?", 1)[0]

        if route == "/api/management":
            params = parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
            period = params.get("period", ["7d"])[0]

            if period not in ("24h", "7d", "30d", "90d"):
                self.send_json({"error": "Período inválido."}, 400)
                return

            try:
                data = get_management_data(period)
                self.send_json({"period": period, **data})
            except Exception as error:
                import traceback
                traceback.print_exc()
                self.send_json({"error": str(error)}, 500)

            return


        if route == "/api/incidents":
            token = os.environ.get("INFLUX_TOKEN")

            if not token:
                self.send_json({
                    "error": "INFLUX_TOKEN não está configurado no processo do dashboard."
                }, 503)
                return

            query = f'''from(bucket: "{INFLUX_BUCKET}")
  |> range(start: 0)
  |> filter(fn: (r) => r._measurement == "sensor_incident")
  |> pivot(rowKey: ["_time", "machine", "reason"], columnKey: ["_field"], valueColumn: "_value")
  |> keep(columns: ["_time", "machine", "reason", "temperature", "vibration"])
  |> sort(columns: ["_time"], desc: true)'''

            try:
                with InfluxDBClient(
                    url=INFLUX_URL,
                    token=token,
                    org=INFLUX_ORG,
                ) as client:
                    tables = client.query_api().query(query, org=INFLUX_ORG)

                incidents_result = []

                for table in tables:
                    for record in table.records:
                        timestamp = record.get_time()
                        values = record.values

                        incidents_result.append({
                            "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
                            "machine": values.get("machine", "Não identificado"),
                            "reason": values.get("reason", "incidente"),
                            "temperature": float(values.get("temperature", 0)),
                            "vibration": float(values.get("vibration", 0)),
                        })

                self.send_json({"incidents": incidents_result})

            except Exception as error:
                print(f"Erro ao consultar incidentes no InfluxDB: {error}")
                self.send_json({
                    "error": "Não foi possível consultar o histórico no InfluxDB."
                }, 500)

            return

        if route != "/api/sensors/sample":
            super().do_GET()
            return

        with sample_lock:
            samples = list(live_samples)
            sample_count = live_sample_count

        if not samples:
            self.send_error(503, "Leituras dos sensores ainda não disponíveis")
            return

        try:
            machine_stops_today = get_machine_stops_today_count()
        except Exception as error:
            print(f"Erro ao consultar paradas da máquina no InfluxDB: {error}")
            self.send_json({
                "error": "Não foi possível consultar as paradas da máquina."
            }, 503)
            return

        self.send_json({
            "samples": samples,
            "total_samples": sample_count,
            "machine_stops_today": machine_stops_today,
        })


def get_machine_stops_today_count():
    token = os.environ.get("INFLUX_TOKEN")
    if not token:
        raise RuntimeError("INFLUX_TOKEN não configurado.")

    local_timezone = ZoneInfo("America/Sao_Paulo")
    today = datetime.now(local_timezone).date()
    start = datetime.combine(today, datetime.min.time(), local_timezone)
    stop = start + timedelta(days=1)
    start_utc = start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    stop_utc = stop.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    query = f'''from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start_utc}, stop: {stop_utc})
  |> filter(fn: (r) => r._measurement == "sensor_incident")
  |> filter(fn: (r) => r.reason == "temperatura_e_vibracao")
  |> filter(fn: (r) => r._field == "incident")
  |> group()
  |> count()'''

    with InfluxDBClient(
        url=INFLUX_URL,
        token=token,
        org=INFLUX_ORG,
    ) as client:
        tables = client.query_api().query(query, org=INFLUX_ORG)

    return sum(int(record.get_value()) for table in tables for record in table.records)


def load_historical_samples():
    """Carrega o histórico existente, sem executar o simulador CLI."""
    global live_sample_count

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

        print(f"Histórico carregado: {len(rows)} leituras.")

    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"Aviso: não foi possível carregar o histórico: {error}")


def generate_samples(stop_event, mqtt_client):
    global live_sample_count

    sample_index = 0
    next_sample_at = time.monotonic()

    while not stop_event.is_set():
        temperature, vibration = generate_live_sample(sample_index)

        recorded_at = datetime.now().astimezone()
        timestamp = recorded_at.isoformat(timespec="seconds")

        with sample_lock:
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

        sample_index += 1
        next_sample_at += 1.0
        stop_event.wait(max(0, next_sample_at - time.monotonic()))


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    load_historical_samples()

    mqtt_client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id="pick-and-place-simulator",
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

    try:
        if not os.environ.get("PICK_AND_PLACE_NO_BROWSER"):
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


import json
import os
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from machine_catalog import MACHINE_IDS, MAX_INCIDENTS_PER_DAY

MQTT_HOST = "127.0.0.1"
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC = "projeto-iot/sensores/pick-and-place-01"

INFLUX_URL = "http://127.0.0.1:8086"
INFLUX_ORG = "projeto-iot"
INFLUX_BUCKET = "sensores"
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN")

if not INFLUX_TOKEN:
    raise RuntimeError("Defina a variável de ambiente INFLUX_TOKEN.")

influx_client = InfluxDBClient(
    url=INFLUX_URL,
    token=INFLUX_TOKEN,
    org=INFLUX_ORG,
)

write_api = influx_client.write_api(write_options=SYNCHRONOUS)


def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        print(f"MQTT conectado. Inscrito em: {MQTT_TOPIC}")
        client.subscribe(MQTT_TOPIC, qos=1)
    else:
        print(f"Falha na conexão MQTT: {reason_code}")


incident_condition_active = {}
consecutive_anomalies = {}


def get_incident_count_today():
    local_timezone = ZoneInfo("America/Sao_Paulo")
    today = datetime.now(local_timezone).date()
    start = datetime.combine(today, time.min, local_timezone)
    stop = start + timedelta(days=1)
    start_utc = start.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    stop_utc = stop.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    query = f'''from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start_utc}, stop: {stop_utc})
  |> filter(fn: (r) => r._measurement == "sensor_incident")
  |> filter(fn: (r) => r._field == "incident")
  |> group()
  |> count()'''

    tables = influx_client.query_api().query(query, org=INFLUX_ORG)
    return sum(int(record.get_value()) for table in tables for record in table.records)


def on_message(client, userdata, message):
    try:
        data = json.loads(message.payload.decode("utf-8"))

        machine_id = data.get("machine", MACHINE_IDS[0])
        if machine_id not in MACHINE_IDS:
            raise ValueError(f"Máquina não cadastrada: {machine_id}")

        temperature = float(data["temperature"])
        vibration = float(data["vibration"])
        timestamp = datetime.fromisoformat(data["timestamp"])

        temperature_threshold = float(data.get("temperature_threshold", 38))
        vibration_threshold = float(data.get("vibration_threshold", 1.2))

        incident_active = (
            temperature > temperature_threshold
            or vibration > vibration_threshold
        )

        point = (
            Point("sensor_reading")
            .tag("machine", machine_id)
            .field("temperature", temperature)
            .field("vibration", vibration)
            .time(timestamp, WritePrecision.S)
        )

        write_api.write(
            bucket=INFLUX_BUCKET,
            org=INFLUX_ORG,
            record=point,
        )

        if incident_active:
            consecutive_anomalies[machine_id] = (
                consecutive_anomalies.get(machine_id, 0) + 1
            )
        else:
            consecutive_anomalies[machine_id] = 0
            incident_condition_active[machine_id] = False

        if (
            incident_active
            and consecutive_anomalies[machine_id] >= 5
            and not incident_condition_active.get(machine_id, False)
        ):
            if temperature > temperature_threshold and vibration > vibration_threshold:
                reason = "temperatura_e_vibracao"
            elif temperature > temperature_threshold:
                reason = "temperatura"
            else:
                reason = "vibracao"

            if get_incident_count_today() < MAX_INCIDENTS_PER_DAY:
                incident_point = (
                    Point("sensor_incident")
                    .tag("machine", machine_id)
                    .tag("reason", reason)
                    .field("incident", 1)
                    .field("temperature", temperature)
                    .field("vibration", vibration)
                    .time(timestamp, WritePrecision.S)
                )

                write_api.write(
                    bucket=INFLUX_BUCKET,
                    org=INFLUX_ORG,
                    record=incident_point,
                )
            else:
                print(
                    f"Limite diário total de {MAX_INCIDENTS_PER_DAY} "
                    "incidentes atingido."
                )

            incident_condition_active[machine_id] = True

    except Exception as error:
        print(f"Erro ao processar mensagem: {error}")


client = mqtt.Client(
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    client_id="pick-and-place-influx-writer",
)

client.on_connect = on_connect
client.on_message = on_message

try:
    print("Conectando ao Mosquitto...")
    client.connect(MQTT_HOST, MQTT_PORT, keepalive=60)
    client.loop_forever()
except KeyboardInterrupt:
    print("\nConsumidor encerrado.")
finally:
    client.disconnect()
    write_api.close()
    influx_client.close()

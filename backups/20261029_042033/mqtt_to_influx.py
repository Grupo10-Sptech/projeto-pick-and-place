
import json
import os
from datetime import datetime

import paho.mqtt.client as mqtt
from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

MQTT_HOST = "127.0.0.1"
MQTT_PORT = 1883
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


def on_message(client, userdata, message):
    try:
        data = json.loads(message.payload.decode("utf-8"))

        temperature = float(data["temperature"])
        vibration = float(data["vibration"])
        timestamp = datetime.fromisoformat(data["timestamp"])

        point = (
            Point("sensor_reading")
            .tag("machine", "pick-and-place-01")
            .field("temperature", temperature)
            .field("vibration", vibration)
            .time(timestamp, WritePrecision.S)
        )

        write_api.write(
            bucket=INFLUX_BUCKET,
            org=INFLUX_ORG,
            record=point,
        )

        print(
            f"Gravado: temperatura={temperature} °C, "
            f"vibração={vibration} g, horário={timestamp}"
        )

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

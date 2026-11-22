
import configparser
import json
import os
import time as system_time
import uuid

from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import boto3
import paho.mqtt.client as mqtt

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from machine_catalog import MACHINE_IDS, MAX_INCIDENTS_PER_DAY


# ============================================================
# CONFIGURAÇÕES MQTT
# ============================================================

MQTT_HOST = "127.0.0.1"
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_TOPIC = "projeto-iot/sensores/pick-and-place-01"


# ============================================================
# CONFIGURAÇÕES INFLUXDB
# ============================================================

INFLUX_URL = "http://127.0.0.1:8086"
INFLUX_ORG = "projeto-iot"
INFLUX_BUCKET = "sensores"
INFLUX_TOKEN = os.environ.get("INFLUX_TOKEN")

if not INFLUX_TOKEN:
    raise RuntimeError("Defina a variável de ambiente INFLUX_TOKEN.")


# ============================================================
# CONFIGURAÇÕES AWS
# ============================================================

S3_BUCKET_BRONZE = os.environ.get(
    "S3_BUCKET_BRONZE",
    "lakehouse-vibradata-bronze",
)

S3_REGION = os.environ.get(
    "AWS_DEFAULT_REGION",
    os.environ.get("AWS_REGION", "us-east-1"),
)

S3_FLUSH_INTERVAL_SECONDS = 600  # 10 minutos

credentials_file = Path(__file__).resolve().with_name("credenciais.txt")

config = configparser.ConfigParser()

if not config.read(credentials_file):
    raise FileNotFoundError(
        f"Arquivo de credenciais não encontrado: {credentials_file}"
    )

if "default" not in config:
    raise RuntimeError(
        "A seção [default] não foi encontrada em credenciais.txt."
    )

aws_credentials = config["default"]

aws_session = boto3.Session(
    aws_access_key_id=aws_credentials["aws_access_key_id"],
    aws_secret_access_key=aws_credentials["aws_secret_access_key"],
    aws_session_token=aws_credentials["aws_session_token"],
    region_name=aws_credentials.get("region", S3_REGION),
)

s3_client = aws_session.client("s3")


# ============================================================
# BUFFER PERSISTENTE LOCAL
# ============================================================

PROJECT_DIR = Path(__file__).resolve().parent

BUFFER_DIR = PROJECT_DIR / "data" / "buffer"
PENDING_DIR = BUFFER_DIR / "pending"

ACTIVE_BUFFER_FILE = BUFFER_DIR / "active.jsonl"

BUFFER_DIR.mkdir(parents=True, exist_ok=True)
PENDING_DIR.mkdir(parents=True, exist_ok=True)

last_bronze_flush = system_time.monotonic()


def save_to_local_buffer(data):
    """
    Grava uma leitura no arquivo local.
    O fsync solicita a sincronização dos dados com o armazenamento.
    """

    serialized_data = json.dumps(
        data,
        ensure_ascii=False,
    ) + "\n"

    with ACTIVE_BUFFER_FILE.open("a", encoding="utf-8") as buffer_file:
        buffer_file.write(serialized_data)
        buffer_file.flush()
        os.fsync(buffer_file.fileno())


def rotate_active_buffer():
    """
    Fecha logicamente o lote ativo e cria um arquivo pendente
    com nome único. O arquivo original não é removido.
    """

    if not ACTIVE_BUFFER_FILE.exists():
        return None

    if ACTIVE_BUFFER_FILE.stat().st_size == 0:
        return None

    file_id = uuid.uuid4().hex

    pending_file = PENDING_DIR / f"bronze-{file_id}.jsonl"

    os.replace(ACTIVE_BUFFER_FILE, pending_file)

    print(
        f"[BUFFER LOCAL] Lote preparado: {pending_file.name}"
    )

    return pending_file


def upload_pending_files():
    """
    Envia todos os arquivos pendentes para o S3.
    O arquivo local só é removido após confirmação do put_object.
    """

    pending_files = sorted(PENDING_DIR.glob("bronze-*.jsonl"))

    if not pending_files:
        return

    for pending_file in pending_files:
        try:
            content = pending_file.read_bytes()

            if not content:
                pending_file.unlink()
                continue

            # Usa a data de criação/modificação do arquivo para
            # organizar os dados nas partições da Bronze.
            file_date = datetime.fromtimestamp(
                pending_file.stat().st_mtime,
                tz=timezone.utc,
            )

            year = file_date.strftime("%Y")
            month = file_date.strftime("%m")
            day = file_date.strftime("%d")
            hour = file_date.strftime("%H")

            # A mesma chave será usada nas tentativas seguintes.
            s3_key = (
                f"telemetria/"
                f"ano={year}/"
                f"mes={month}/"
                f"dia={day}/"
                f"hora={hour}/"
                f"{pending_file.name}"
            )

            s3_client.put_object(
                Bucket=S3_BUCKET_BRONZE,
                Key=s3_key,
                Body=content,
                ContentType="application/x-ndjson",
                ServerSideEncryption="AES256",
            )

            # Só exclui o arquivo depois da confirmação do S3.
            pending_file.unlink()

            number_of_readings = content.count(b"\n")

            print(
                f"[S3 BRONZE] Lote enviado: "
                f"{number_of_readings} leituras | "
                f"s3://{S3_BUCKET_BRONZE}/{s3_key}"
            )

        except Exception as error:
            print(
                f"[S3 BRONZE] Falha ao enviar "
                f"{pending_file.name}: {error}"
            )

            print(
                "[BUFFER LOCAL] Arquivo preservado. "
                "Será tentado novamente."
            )


def flush_bronze_batch(force=False):
    """
    A cada 10 minutos:
    1. Transforma o arquivo ativo em lote pendente.
    2. Tenta enviar os arquivos pendentes ao S3.

    Com force=True, executa as duas operações imediatamente.
    """

    global last_bronze_flush

    elapsed = system_time.monotonic() - last_bronze_flush

    if force or elapsed >= S3_FLUSH_INTERVAL_SECONDS:
        rotate_active_buffer()
        last_bronze_flush = system_time.monotonic()

    upload_pending_files()


def recover_pending_files():
    """
    Executada na inicialização.
    Recupera o arquivo ativo que possa ter sobrado de uma
    execução anterior e tenta enviar todos os lotes pendentes.
    """

    print("[BUFFER LOCAL] Verificando arquivos pendentes...")

    rotate_active_buffer()

    pending_files = list(PENDING_DIR.glob("bronze-*.jsonl"))

    print(
        f"[BUFFER LOCAL] {len(pending_files)} lote(s) "
        "aguardando envio."
    )

    upload_pending_files()


# ============================================================
# CONEXÃO INFLUXDB
# ============================================================

influx_client = InfluxDBClient(
    url=INFLUX_URL,
    token=INFLUX_TOKEN,
    org=INFLUX_ORG,
)

write_api = influx_client.write_api(
    write_options=SYNCHRONOUS
)


# ============================================================
# CONTROLE MQTT E INCIDENTES
# ============================================================

incident_condition_active = {}
consecutive_anomalies = {}


def on_connect(client, userdata, flags, reason_code, properties=None):
    if reason_code == 0:
        print(f"MQTT conectado. Inscrito em: {MQTT_TOPIC}")
        client.subscribe(MQTT_TOPIC, qos=1)
    else:
        print(f"Falha na conexão MQTT: {reason_code}")


def get_incident_count_today():
    local_timezone = ZoneInfo("America/Sao_Paulo")

    today = datetime.now(local_timezone).date()

    start = datetime.combine(
        today,
        time.min,
        local_timezone,
    )

    stop = start + timedelta(days=1)

    start_utc = (
        start.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )

    stop_utc = (
        stop.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )

    query = f'''from(bucket: "{INFLUX_BUCKET}")
  |> range(start: {start_utc}, stop: {stop_utc})
  |> filter(fn: (r) => r._measurement == "sensor_incident")
  |> filter(fn: (r) => r._field == "incident")
  |> group()
  |> count()'''

    tables = influx_client.query_api().query(
        query,
        org=INFLUX_ORG,
    )

    return sum(
        int(record.get_value())
        for table in tables
        for record in table.records
    )


def on_message(client, userdata, message):
    try:
        data = json.loads(message.payload.decode("utf-8"))

        machine_id = data.get("machine", MACHINE_IDS[0])

        if machine_id not in MACHINE_IDS:
            raise ValueError(
                f"Máquina não cadastrada: {machine_id}"
            )

        temperature = float(data["temperature"])
        vibration = float(data["vibration"])

        timestamp = datetime.fromisoformat(data["timestamp"])

        temperature_threshold = float(
            data.get("temperature_threshold", 38)
        )

        vibration_threshold = float(
            data.get("vibration_threshold", 1.2)
        )

        incident_active = (
            temperature > temperature_threshold
            or vibration > vibration_threshold
        )

        # Primeiro salva localmente. Assim, a leitura já fica
        # preservada antes das operações seguintes.
        save_to_local_buffer(data)

        # Mantém a gravação original no InfluxDB.
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

        # Mantém a lógica original de anomalias consecutivas.
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
            if (
                temperature > temperature_threshold
                and vibration > vibration_threshold
            ):
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

        # Verifica se chegou o momento de enviar os lotes.
        flush_bronze_batch()

    except Exception as error:
        print(f"Erro ao processar mensagem: {error}")


# ============================================================
# INICIALIZAÇÃO
# ============================================================

client = mqtt.Client(
    callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    client_id="pick-and-place-influx-writer",
)

client.on_connect = on_connect
client.on_message = on_message


try:
    # Recupera dados de execuções anteriores antes de receber
    # novas leituras.
    recover_pending_files()

    print("Conectando ao Mosquitto...")

    client.connect(
        MQTT_HOST,
        MQTT_PORT,
        keepalive=60,
    )

    client.loop_forever()

except KeyboardInterrupt:
    print("\nConsumidor encerrado.")

finally:
    print("[BUFFER LOCAL] Preparando envio final para a Bronze...")

    try:
        flush_bronze_batch(force=True)
    except Exception as error:
        print(f"[BUFFER LOCAL] Erro no envio final: {error}")

    client.disconnect()

    write_api.close()
    influx_client.close()

    print("[BUFFER LOCAL] Verifique data/buffer/pending para "
          "consultar eventuais lotes ainda não enviados.")

import argparse
import os
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from influxdb_client import InfluxDBClient, Point, WritePrecision
from influxdb_client.client.write_api import SYNCHRONOUS

from machine_catalog import MACHINE_IDS
from scripts.incident_schedule import build_daily_incident_schedule
from scripts.simulate_sensors import generate_live_sample

INFLUX_URL = "http://127.0.0.1:8086"
INFLUX_ORG = "projeto-iot"
INFLUX_BUCKET = "sensores"
SAMPLE_INTERVAL = timedelta(minutes=5)
SAMPLES_PER_WEEK = 7 * 24 * 60 // 5
LOCAL_TIMEZONE = ZoneInfo("America/Sao_Paulo")


def build_incident_schedule(timestamps: list[datetime]) -> dict[int, tuple[str, str]]:
    sample_indexes_by_day: dict[date, list[int]] = {}
    for sample_index, timestamp in enumerate(timestamps):
        local_day = timestamp.astimezone(LOCAL_TIMEZONE).date()
        sample_indexes_by_day.setdefault(local_day, []).append(sample_index)

    schedule = {}
    for sample_indexes in sample_indexes_by_day.values():
        for sample_index, machine_id, reason in build_daily_incident_schedule(
            sample_indexes,
            MACHINE_IDS,
        ):
            schedule[sample_index] = (machine_id, reason)

    return schedule


def build_demo_points(
    end_time: datetime,
) -> tuple[list[Point], dict[str, int], dict[str, int]]:
    end_time = end_time.astimezone(timezone.utc).replace(second=0, microsecond=0)
    start_time = end_time - timedelta(days=7)
    timestamps = [
        start_time + sample_index * SAMPLE_INTERVAL
        for sample_index in range(SAMPLES_PER_WEEK)
    ]
    incident_indexes = build_incident_schedule(timestamps)

    points = []
    incident_counts = {machine_id: 0 for machine_id in MACHINE_IDS}
    daily_incident_counts: Counter[str] = Counter()

    for sample_index, timestamp in enumerate(timestamps):
        scheduled_incident = incident_indexes.get(sample_index)
        for machine_index, machine_id in enumerate(MACHINE_IDS):
            temperature, vibration = generate_live_sample(sample_index, machine_index)
            is_incident = scheduled_incident is not None and (
                scheduled_incident[0] == machine_id
            )
            reason = scheduled_incident[1] if is_incident else None

            if is_incident:
                if reason in ("temperatura", "temperatura_e_vibracao"):
                    temperature = round(39.0 + machine_index * 0.1, 2)
                if reason in ("vibracao", "temperatura_e_vibracao"):
                    vibration = round(1.3 + machine_index * 0.01, 3)
                incident_counts[machine_id] += 1
                local_day = timestamp.astimezone(LOCAL_TIMEZONE).date().isoformat()
                daily_incident_counts[local_day] += 1

            points.append(
                Point("sensor_reading")
                .tag("machine", machine_id)
                .field("temperature", temperature)
                .field("vibration", vibration)
                .time(timestamp, WritePrecision.S)
            )

            if is_incident:
                points.append(
                    Point("sensor_incident")
                    .tag("machine", machine_id)
                    .tag("reason", reason)
                    .field("incident", 1)
                    .field("temperature", temperature)
                    .field("vibration", vibration)
                    .time(timestamp, WritePrecision.S)
                )

    return points, incident_counts, dict(daily_incident_counts)


def bucket_has_data(client: InfluxDBClient) -> bool:
    query = f'''from(bucket: "{INFLUX_BUCKET}")
  |> range(start: 0)
  |> limit(n: 1)'''
    tables = client.query_api().query(query, org=INFLUX_ORG)
    return any(table.records for table in tables)


def seed_demo_data(reset: bool = False) -> dict[str, int] | None:
    token = os.environ.get("INFLUX_TOKEN")
    if not token:
        raise RuntimeError("INFLUX_TOKEN não configurado.")

    with InfluxDBClient(
        url=INFLUX_URL,
        token=token,
        org=INFLUX_ORG,
    ) as client:
        if reset:
            delete_api = client.delete_api()
            for measurement in ("sensor_reading", "sensor_incident"):
                delete_api.delete(
                    start=datetime(1970, 1, 1, tzinfo=timezone.utc),
                    stop=datetime.now(timezone.utc) + timedelta(days=1),
                    predicate=f'_measurement="{measurement}"',
                    bucket=INFLUX_BUCKET,
                    org=INFLUX_ORG,
                )
        elif bucket_has_data(client):
            print("O bucket já contém dados; nenhuma limpeza ou carga foi feita.")
            return None

        points, incident_counts, daily_incident_counts = build_demo_points(
            datetime.now(timezone.utc)
        )
        with client.write_api(write_options=SYNCHRONOUS) as write_api:
            write_api.write(
                bucket=INFLUX_BUCKET,
                org=INFLUX_ORG,
                record=points,
            )

    print(f"Leituras históricas gravadas: {SAMPLES_PER_WEEK * len(MACHINE_IDS)}.")
    print(f"Incidentes gravados por máquina: {incident_counts}.")
    print(f"Incidentes gravados por dia: {daily_incident_counts}.")
    return incident_counts


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inicializa ou reinicializa os dados de demonstração das 10 máquinas."
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Apaga os dados do bucket local 'sensores' antes de gerar os últimos 7 dias.",
    )
    args = parser.parse_args()
    seed_demo_data(reset=args.reset)


if __name__ == "__main__":
    main()

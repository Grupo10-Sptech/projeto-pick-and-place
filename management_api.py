
import os
from collections import Counter
from influxdb_client import InfluxDBClient
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

URL = "http://127.0.0.1:8086"
ORG = "projeto-iot"
BUCKET = "sensores"

VALID_PERIODS = ("24h", "7d", "30d", "90d")
PERIOD_DURATIONS = {
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
    "30d": timedelta(days=30),
    "90d": timedelta(days=90)
}
PLANNED_HOURS_PER_DAY = 20
DOWNTIME_COST_PER_INCIDENT = 150


def get_peak(api, period, field):
    query = f'''
from(bucket: "{BUCKET}")
  |> range(start: -{period})
  |> filter(fn: (r) => r._measurement == "sensor_reading")
  |> filter(fn: (r) => r._field == "{field}")
  |> group()
  |> sort(columns: ["_value"], desc: true)
  |> limit(n: 1)
'''

    tables = api.query(query, org=ORG)

    for table in tables:
        for record in table.records:
            return {
                "value": float(record.get_value()),
                "time": record.get_time().isoformat()
            }

    return None


def get_management_data(period):
    if period not in VALID_PERIODS:
        raise ValueError("Período inválido.")

    token = os.environ.get("INFLUX_TOKEN")
    if not token:
        raise RuntimeError("INFLUX_TOKEN não configurado.")

    with InfluxDBClient(url=URL, token=token, org=ORG) as client:
        api = client.query_api()

        incident_query = f'''
from(bucket: "{BUCKET}")
  |> range(start: -{period})
  |> filter(fn: (r) => r._measurement == "sensor_incident")
  |> pivot(
      rowKey: ["_time", "machine", "reason"],
      columnKey: ["_field"],
      valueColumn: "_value"
  )
  |> sort(columns: ["_time"], desc: true)
'''

        incident_tables = api.query(incident_query, org=ORG)
        incidents = []

        for table in incident_tables:
            for record in table.records:
                values = record.values

                incidents.append({
                    "time": record.get_time().isoformat(),
                    "reason": values.get("reason", "Não informado")
                })

        daily = Counter()
        combined_daily = Counter()
        reasons = Counter()

        timezone = ZoneInfo("America/Sao_Paulo")
        end_time = datetime.now(timezone)
        start_time = end_time - PERIOD_DURATIONS[period]
        day = start_time.date()
        planned_hours_daily = {}

        while day <= end_time.date():
            day_start = datetime.combine(day, time.min, tzinfo=timezone)
            day_end = day_start + timedelta(days=1)
            overlap_start = max(start_time, day_start)
            overlap_end = min(end_time, day_end)
            day_key = day.isoformat()

            daily[day_key] = 0
            combined_daily[day_key] = 0
            planned_hours_daily[day_key] = round(
                max((overlap_end - overlap_start).total_seconds(), 0)
                / 3600
                * PLANNED_HOURS_PER_DAY
                / 24,
                2
            )
            day += timedelta(days=1)

        for incident in incidents:
            local_time = datetime.fromisoformat(
                incident["time"]
            ).astimezone(timezone)

            day = local_time.date().isoformat()
            reason = incident["reason"] or "Não informado"

            if day not in daily:
                continue

            daily[day] += 1
            reasons[reason] += 1
            if reason == "temperatura_e_vibracao":
                combined_daily[day] += 1

        most_expensive_day = None
        if combined_daily and max(combined_daily.values()) > 0:
            day, incident_count = max(
                combined_daily.items(),
                key=lambda item: item[1]
            )
            most_expensive_day = {
                "date": day,
                "cost": incident_count * DOWNTIME_COST_PER_INCIDENT,
                "incident_count": incident_count,
            }

        most_incident_day = None
        if daily:
            day, count = max(daily.items(), key=lambda item: item[1])
            most_incident_day = {
                "date": day,
                "count": count
            }

        primary_cause = None
        if reasons:
            reason, count = max(
                reasons.items(),
                key=lambda item: item[1]
            )
            primary_cause = {
                "reason": reason,
                "count": count
            }

        return {
            "incidents": {
                "total": len(incidents),
                "daily": dict(sorted(daily.items())),
                "combined_daily": dict(sorted(combined_daily.items())),
                "planned_hours_daily": dict(sorted(planned_hours_daily.items())),
                "reasons": dict(reasons),
                "most_expensive_day": most_expensive_day,
                "most_incident_day": most_incident_day,
                "primary_cause": primary_cause,
                "combined_total": reasons.get(
                    "temperatura_e_vibracao", 0
                )
            },
            "temperature_peak": get_peak(
                api, period, "temperature"
            ),
            "vibration_peak": get_peak(
                api, period, "vibration"
            )
        }

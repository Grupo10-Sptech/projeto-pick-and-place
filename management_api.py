
import os
from collections import Counter
from influxdb_client import InfluxDBClient
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

URL = "http://127.0.0.1:8086"
ORG = "projeto-iot"
BUCKET = "sensores"

VALID_PERIODS = ("24h", "7d", "30d", "90d")


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
        reasons = Counter()

        today = datetime.now(ZoneInfo("America/Sao_Paulo")).date()

        for i in range(6, -1, -1):
            day = today - timedelta(days=i)
            daily[day.isoformat()] = 0

        for incident in incidents:
            local_time = datetime.fromisoformat(
                incident["time"]
            ).astimezone(ZoneInfo("America/Sao_Paulo"))

            day = local_time.date().isoformat()
            reason = incident["reason"] or "Não informado"

            daily[day] += 1
            reasons[reason] += 1

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
                "reasons": dict(reasons),
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

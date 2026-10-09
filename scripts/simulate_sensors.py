import argparse
import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

random.seed(42)

base_dir = Path(__file__).resolve().parent.parent
output_file = base_dir / "data" / "sensor_data.json"
TEMPERATURE_THRESHOLD_C = 38.0
VIBRATION_THRESHOLD_G = 1.2


def generate_temperature(index: int, drift: float = 0.0) -> float:
    base = 29.5 + drift
    daily_cycle = 2.7 * math.sin(index / 18.0)
    thermal_drift = 0.8 * math.sin(index / 95.0)
    jitter = random.uniform(-0.9, 0.9)
    spike = 1.6 if index % 87 == 0 else 0.0
    return round(base + daily_cycle + thermal_drift + jitter + spike, 2)


def generate_vibration(index: int, drift: float = 0.0) -> float:
    base = 0.78 + drift
    harmonic = 0.18 * math.sin(index / 11.0)
    medium_noise = 0.07 * math.sin(index / 4.0)
    jitter = random.uniform(-0.08, 0.08)
    spike = 0.38 if index % 53 == 0 else 0.0
    value = base + harmonic + medium_noise + jitter + spike
    return round(max(0.18, value), 3)


def generate_live_sample(index: int) -> tuple[float, float]:
    drift_factor = 0.12 * math.sin(index / 60.0)
    temperature = generate_temperature(index, drift_factor)
    vibration = generate_vibration(index, drift_factor * 0.35)

    anomaly_phase = (index - 20) % 120
    if index >= 20 and anomaly_phase < 8:
        temperature = round(temperature + 10.0, 2)
        vibration = round(vibration + 0.8, 3)

    return temperature, vibration


def average(values):
    return sum(values) / len(values) if values else 0.0


def main() -> None:
    parser = argparse.ArgumentParser(description="Gerar dados simulados de sensores IoT para monitoramento de vibração e temperatura.")
    parser.add_argument("--samples", type=int, default=3600, help="Quantidade de leituras do histórico simuladas.")
    parser.add_argument("--interval-seconds", type=int, default=1, help="Intervalo de coleta em segundos entre as amostras.")
    args = parser.parse_args()

    now = datetime.now()
    points = max(100, args.samples)
    interval = max(1, args.interval_seconds)
    timestamps = []
    temperatures = []
    vibrations = []

    for idx in range(points):
        timestamp = now - timedelta(seconds=(points - 1 - idx) * interval)
        timestamps.append(timestamp.strftime("%Y-%m-%dT%H:%M:%S"))

        drift_factor = 0.12 * math.sin(idx / 60.0)
        temperatures.append(generate_temperature(idx, drift_factor))
        vibrations.append(generate_vibration(idx, drift_factor * 0.35))

    temp_avg = average(temperatures)
    vib_avg = average(vibrations)
    temp_max = max(temperatures)
    vib_max = max(vibrations)

    payload = {
        "machine": {
            "id": "pick-and-place-01",
            "name": "Pick-and-Place",
            "line": "Linha de montagem",
            "site": "Fábrica de bancada"
        },
        "iot": {
            "device": "ESP32",
            "network": "Wi-Fi industrial",
            "protocol": "HTTP JSON"
        },
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "sampling": {
            "samples": points,
            "interval_seconds": interval,
            "window_hours": round((points * interval) / 3600, 2),
            "window_label": f"{points} pontos / {round((points * interval) / 3600, 2)} horas"
        },
        "temperature": {
            "label": "Temperatura (°C)",
            "unit": "°C",
            "values": temperatures,
            "timestamps": timestamps,
            "threshold": TEMPERATURE_THRESHOLD_C,
            "avg": round(temp_avg, 2),
            "max": round(temp_max, 2),
        },
        "vibration": {
            "label": "Vibração (g RMS)",
            "unit": "g",
            "values": vibrations,
            "timestamps": timestamps,
            "threshold": VIBRATION_THRESHOLD_G,
            "avg": round(vib_avg, 3),
            "max": round(vib_max, 3),
        },
        "summary": {
            "status": "Operação estável",
            "temperature_average_c": round(temp_avg, 2),
            "vibration_average_g": round(vib_avg, 3),
            "max_temperature_c": round(temp_max, 2),
            "max_vibration_g": round(vib_max, 3)
        }
    }

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Arquivo gerado: {output_file}")
    print(f"Amostras: {points} | Intervalo: {interval}s | Janela: {payload['sampling']['window_hours']}h")
    print(f"Temperatura média: {payload['summary']['temperature_average_c']} °C")
    print(f"Vibração média: {payload['summary']['vibration_average_g']} g")


if __name__ == "__main__":
    main()

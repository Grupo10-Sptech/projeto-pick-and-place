import random
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import TypeVar

T = TypeVar("T")

INCIDENT_REASONS = (
    "temperatura",
    "vibracao",
    "temperatura_e_vibracao",
)
MAX_INCIDENTS_PER_DAY = 5


def build_daily_incident_schedule(
    slots: Sequence[T],
    machine_ids: Sequence[str],
    rng: random.Random | None = None,
) -> list[tuple[T, str, str]]:
    if not slots or not machine_ids:
        return []

    randomizer = rng or random.SystemRandom()
    incident_count = randomizer.randint(
        1,
        min(MAX_INCIDENTS_PER_DAY, len(slots), len(machine_ids)),
    )
    selected_slots = sorted(randomizer.sample(slots, incident_count))
    selected_machines = randomizer.sample(machine_ids, incident_count)

    return [
        (slot, machine_id, randomizer.choice(INCIDENT_REASONS))
        for slot, machine_id in zip(selected_slots, selected_machines)
    ]


def build_live_incident_schedule(
    start_time: datetime,
    day_end: datetime,
    machine_ids: Sequence[str],
    rng: random.Random | None = None,
) -> list[tuple[datetime, str, str]]:
    available_seconds = max(0, int((day_end - start_time).total_seconds()) - 10)
    offsets = range(5, available_seconds)
    randomizer = rng or random.SystemRandom()
    schedule = [
        (start_time + timedelta(seconds=offset), machine_id, reason)
        for offset, machine_id, reason in build_daily_incident_schedule(
            offsets,
            machine_ids,
            randomizer,
        )
    ]
    if schedule:
        early_window_end = min(120, available_seconds)
        early_offset = randomizer.randrange(5, early_window_end)
        _, machine_id, reason = schedule[0]
        schedule[0] = (
            start_time + timedelta(seconds=early_offset),
            machine_id,
            reason,
        )

    return schedule

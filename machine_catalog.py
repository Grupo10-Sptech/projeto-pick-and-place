MACHINE_IDS = tuple(f"pick-and-place-{number:02d}" for number in range(1, 11))
MACHINE_NAMES = {
    machine_id: f"Máquina {number}"
    for number, machine_id in enumerate(MACHINE_IDS, start=1)
}

MAX_INCIDENTS_PER_DAY = 5

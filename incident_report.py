from io import BytesIO
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from machine_catalog import MACHINE_NAMES


def build_incidents_workbook(records, local_timezone: ZoneInfo) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Incidentes"
    worksheet.append([
        "Data",
        "Máquina",
        "Temperatura registrada (°C)",
        "Vibração registrada (g)",
        "Foi incidente combinado?",
    ])

    for record in records:
        values = record.values
        timestamp = record.get_time().astimezone(local_timezone).replace(tzinfo=None)
        machine_id = values.get("machine")
        reason = values.get("reason", "")

        worksheet.append([
            timestamp,
            MACHINE_NAMES.get(machine_id, machine_id or "Máquina não identificada"),
            values.get("temperature"),
            values.get("vibration"),
            "Sim" if reason == "temperatura_e_vibracao" else "Não",
        ])

    header_fill = PatternFill(fill_type="solid", fgColor="1E2942")
    for cell in worksheet[1]:
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    for row in worksheet.iter_rows(min_row=2):
        row[0].number_format = "dd/mm/yyyy hh:mm:ss"
        row[2].number_format = "0.00"
        row[3].number_format = "0.000"

    column_widths = (22, 18, 30, 26, 30)
    for index, width in enumerate(column_widths, start=1):
        worksheet.column_dimensions[get_column_letter(index)].width = width

    worksheet.freeze_panes = "A2"
    worksheet.auto_filter.ref = f"A1:E{max(worksheet.max_row, 1)}"

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()

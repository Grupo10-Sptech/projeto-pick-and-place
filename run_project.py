import subprocess
import sys
import time
import webbrowser
from pathlib import Path

root = Path(__file__).resolve().parent

print("Gerando dados dos sensores...")
subprocess.run(
    [sys.executable, str(root / "scripts" / "simulate_sensors.py")],
    check=True,
)

print("Iniciando servidor local...")
server = subprocess.Popen(
    [sys.executable, "-m", "http.server", "8000", "--directory", str(root)],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

time.sleep(1)
webbrowser.open("http://localhost:8000/")

print("Projeto rodando em: http://localhost:8000/")
print("Pressione Ctrl+C para encerrar.")

try:
    server.wait()
except KeyboardInterrupt:
    print("\nEncerrando servidor...")
    server.terminate()

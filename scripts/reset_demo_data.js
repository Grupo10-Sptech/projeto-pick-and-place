import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const pythonRelativePath = process.platform === "win32"
  ? path.join(".venv", "Scripts", "python.exe")
  : path.join(".venv", "bin", "python");
const pythonCommand = existsSync(path.join(projectRoot, pythonRelativePath))
  ? path.join(projectRoot, pythonRelativePath)
  : "python";
const env = {
  ...process.env,
  INFLUX_TOKEN: process.env.INFLUX_TOKEN || "pick-and-place-local-dev-token"
};

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
  }
}

try {
  run("docker", ["compose", "up", "-d", "--wait", "--wait-timeout", "300", "influxdb"]);
  run(pythonCommand, ["-m", "scripts.seed_demo_data", "--reset"]);
} catch (error) {
  console.error(`Não foi possível reinicializar os dados de demonstração: ${error.message}`);
  process.exitCode = 1;
}

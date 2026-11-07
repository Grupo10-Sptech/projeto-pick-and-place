import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const localInfluxToken = "pick-and-place-local-dev-token";
const env = {
  ...process.env,
  INFLUX_TOKEN: localInfluxToken,
  MQTT_PORT: "1884",
  PICK_AND_PLACE_NO_BROWSER: "1"
};
const isWindows = process.platform === "win32";
const pythonRelativePath = isWindows
  ? path.join("Scripts", "python.exe")
  : path.join("bin", "python");
const pythonCandidates = [
  process.env.VIRTUAL_ENV && path.join(process.env.VIRTUAL_ENV, pythonRelativePath),
  path.join(projectRoot, ".venv", pythonRelativePath)
].filter(Boolean);
const pythonCommand =
  pythonCandidates.find((candidate) => existsSync(candidate)) || "python";
const children = [];
let stopping = false;
let composeStarted = false;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBackend() {
  for (let attempt = 0; attempt < 120 && !stopping; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/auth/me");
      if (response.status === 401 || response.ok) return;
    } catch {
      // The Python server may still be starting.
    }

    await sleep(500);
  }

  if (!stopping) {
    throw new Error("The local API did not become ready within 60 seconds.");
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env,
      stdio: "inherit",
      windowsHide: true,
      ...options
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function ensureDockerIsRunning() {
  try {
    await runCommand("docker", ["info"], { stdio: "ignore" });
    return;
  } catch {
    if (!isWindows) {
      throw new Error("Docker is not running. Start Docker Desktop and retry.");
    }
  }

  const dockerCli = process.env.ProgramFiles
    ? path.join(
        process.env.ProgramFiles,
        "Docker",
        "Docker",
        "resources",
        "bin",
        "docker.exe"
      )
    : null;
  const desktopCandidates = [
    dockerCli && path.resolve(path.dirname(dockerCli), "..", "..", "Docker Desktop.exe"),
    process.env.ProgramFiles &&
      path.join(process.env.ProgramFiles, "Docker", "Docker", "Docker Desktop.exe")
  ].filter(Boolean);
  const desktopPath = desktopCandidates.find((candidate) => existsSync(candidate));

  if (!desktopPath) {
    throw new Error("Docker Desktop is not installed.");
  }

  console.log("Docker Desktop is stopped; starting it...");
  await new Promise((resolve, reject) => {
    const desktop = spawn(desktopPath, [], {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });
    desktop.once("error", reject);
    desktop.once("spawn", resolve);
    desktop.unref();
  });

  for (let attempt = 0; attempt < 60 && !stopping; attempt += 1) {
    await sleep(3000);
    try {
      await runCommand("docker", ["info"], { stdio: "ignore" });
      return;
    } catch {
      // Docker Desktop can take a while to start its engine.
    }
  }

  throw new Error("Docker Desktop did not start its engine within 3 minutes.");
}

function startProcess(command, args) {
  const child = spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    windowsHide: true
  });

  children.push(child);
  child.once("error", (error) => {
    console.error(`Could not start ${command}:`, error);
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `${path.basename(command)} stopped unexpectedly ` +
        `(${signal || `exit code ${code}`}).`
      );
      void shutdown(code || 1);
    }
  });
}

async function shutdown(exitCode) {
  if (stopping) return;
  stopping = true;

  const childExits = children.map((child) =>
    child.pid === undefined || child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((resolve) => child.once("exit", resolve))
  );

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }

  await Promise.all(childExits);

  if (composeStarted) {
    try {
      await runCommand("docker", ["compose", "down"]);
    } catch (error) {
      console.error("Could not stop the local Docker services:", error.message);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
if (isWindows) process.once("SIGBREAK", () => void shutdown(0));

try {
  await ensureDockerIsRunning();
  if (stopping) process.exitCode = 0;
  else {
    console.log("Starting local Mosquitto and InfluxDB services...");
    composeStarted = true;
    await runCommand("docker", [
      "compose",
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "300"
    ]);
  }

  if (!stopping) {
    startProcess(pythonCommand, [
      path.join(projectRoot, "run_project.py")
    ]);
    await waitForBackend();
  }

  if (!stopping) {
    startProcess(pythonCommand, [
      path.join(projectRoot, "mqtt_to_influx.py")
    ]);
    startProcess(process.execPath, [
      path.join(projectRoot, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "localhost",
      "--open"
    ]);
  }
} catch (error) {
  console.error(`Could not start the project: ${error.message}`);
  console.error(
    "Make sure Docker Desktop is installed and running, then try npm run dev again."
  );
  await shutdown(1);
}

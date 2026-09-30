import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RAZER_BIN = process.env["RAZER_BIN"] ?? "razer";
const stateFile = "./state.json";

const NAMED_COLORS = new Map([
  ["red", "FF0000"],
  ["green", "00FF00"],
  ["blue", "0000FF"],
  ["white", "FFFFFF"],
  ["purple", "8000FF"],
  ["cyan", "00FFFF"],
  ["yellow", "FFFF00"],
  ["orange", "FF8000"],
  ["pink", "FF00FF"],
]);

const defaultState = {
  effect: "static",
  colors: ["FF0000"],
  direction: "right",
  speed: null,
  brightness: 255,
  logo: 1,
};

/* ---------- helpers ---------- */

function normalizeColor(value) {
  if (typeof value !== "string") throw new Error("color must be a string");
  const named = NAMED_COLORS.get(value.toLowerCase());
  if (named) return named;
  const hex = value.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`invalid color '${value}' (expected RRGGBB)`);
  }
  return hex.toUpperCase();
}

function normalizeColors(list, min, max) {
  const arr = Array.isArray(list) ? list : list == null ? [] : [list];
  if (arr.length < min || arr.length > max) {
    throw new Error(
      min === max
        ? `expected exactly ${min} color(s)`
        : `expected ${min}-${max} color(s)`,
    );
  }
  return arr.map(normalizeColor);
}

function normalizeInt(value, min, max, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer ${min}-${max}`);
  }
  return n;
}

function buildEffectArgs(settings) {
  const { effect, direction, speed } = settings;

  switch (effect) {
    case "none":
    case "spectrum":
    case "pulsate":
    case "custom":
      return [`--${effect}`];

    case "static":
    case "static-no-store": {
      const [c] = normalizeColors(settings.colors, 1, 1);
      return [`--${effect}`, c];
    }

    case "wave": {
      const dir = direction ?? "right";
      if (dir !== "left" && dir !== "right") {
        throw new Error("direction must be 'left' or 'right'");
      }
      const args = [`--wave=${dir}`];
      if (speed != null) {
        args.push("--speed", String(normalizeInt(speed, 1, 255, "wave speed")));
      }
      return args;
    }

    case "breath": {
      const colors = normalizeColors(settings.colors, 0, 2);
      return ["--breath", ...colors];
    }

    case "reactive": {
      const [c] = normalizeColors(settings.colors, 1, 1);
      const args = ["--reactive", c];
      if (speed != null) {
        args.push(
          "--speed",
          String(normalizeInt(speed, 1, 3, "reactive speed")),
        );
      }
      return args;
    }

    case "starlight": {
      const colors = normalizeColors(settings.colors, 0, 2);
      const args = ["--starlight", ...colors];
      if (speed != null) {
        args.push(
          "--speed",
          String(normalizeInt(speed, 1, 3, "starlight speed")),
        );
      }
      return args;
    }

    default:
      throw new Error(`unknown effect '${effect}'`);
  }
}

/* ---------- CLI runner (serialized so USB writes never overlap) ---------- */

let queue = Promise.resolve();

function runRazer(args, product) {
  const fullArgs = product ? [...args, "--product", String(product)] : args;

  const job = queue.then(async () => {
    console.log(`> ${RAZER_BIN} ${fullArgs.join(" ")}`);
    try {
      const { stdout, stderr } = await execFileAsync(RAZER_BIN, fullArgs);
      return { ok: true, stdout, stderr };
    } catch (err) {
      return {
        ok: false,
        stdout: err.stdout ?? "",
        stderr: err.stderr || err.message,
      };
    }
  });

  queue = job.catch(() => {});
  return job;
}

/* ---------- state ---------- */

let state = { ...defaultState };

try {
  const saved = JSON.parse(await readFile(stateFile, "utf8"));
  if (saved.color && !saved.colors) {
    saved.colors = [normalizeColor(saved.color)];
    delete saved.color;
  }
  state = { ...defaultState, ...saved };
} catch {}

async function saveState() {
  await writeFile(stateFile, JSON.stringify(state, null, 2));
}

/* ---------- device presence ---------- */

const POLL_MS = 1500;
const SETTLE_MS = 1000;
const RAZER_VENDOR_ID = 5426; // 0x1532

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let devicePresent = null; // null = not checked yet
let lastSignature = null;
let settleTimer = null;
let polling = false;

async function razerUsbSignature() {
  const { stdout } = await execFileAsync(
    "ioreg", // https://www.manpagez.com/man/8/ioreg/
    ["-p", "IOUSB", "-l", "-w0"],
    { maxBuffer: 16 * 1024 * 1024 },
  );

  const found = [];

  for (const chunk of stdout.split("+-o ")) {
    const vendor = chunk.match(/"idVendor"\s*=\s*(\d+)/);
    const product = chunk.match(/"idProduct"\s*=\s*(\d+)/);
    const location = chunk.match(/"locationID"\s*=\s*(\d+)/);

    if (vendor && Number(vendor[1]) === RAZER_VENDOR_ID) {
      found.push(`${product?.[1] ?? "?"}@${location?.[1] ?? "?"}`);
    }
  }

  return found.sort().join(",");
}

async function pollUsb() {
  if (polling) return;
  polling = true;

  try {
    const signature = await razerUsbSignature();
    if (signature === lastSignature) return;

    lastSignature = signature;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(refreshPresence, SETTLE_MS);
  } catch (err) {
    console.error("usb poll failed:", err.message);
  } finally {
    polling = false;
  }
}

async function refreshPresence() {
  const result = await runRazer(["--list"]);

  if (!result.ok && !result.stdout) {
    console.error("razer --list failed:", result.stderr);
    return;
  }

  const present = /\(keyboard\)/.test(result.stdout);
  if (present === devicePresent) return;

  devicePresent = present;
  console.log(`keyboard ${present ? "connected" : "disconnected"}`);
  sendDevice();

  if (present) await restoreState();
}

async function restoreState() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let steps;

    try {
      steps = [
        buildEffectArgs(state),
        ["--brightness", String(state.brightness)],
        // ["--logo", String(state.logo)],
      ];
    } catch (err) {
      console.error("saved state is invalid, not restoring:", err.message);
      return;
    }

    let ok = true;

    for (const args of steps) {
      const result = await runRazer(args);
      if (!result.ok) {
        ok = false;
        break;
      }
    }

    if (ok) {
      console.log("state restored");
      sendState();
      return;
    }

    if (devicePresent === false) return; // edge-case: unplugged again mid-restore
    await sleep(1000);
  }

  sendError("Could not restore lighting after reconnect.", "keyboard:device");
}

setInterval(pollUsb, POLL_MS);
pollUsb();

/* ---------- websocket ---------- */

const token = process.env["KEYBOARD_MACOS_TOKEN"];
if (!token) {
  console.error("KEYBOARD_MACOS_TOKEN is not set");
  process.exit(1);
}

const url = new URL("ws://localhost:6767");
url.searchParams.set("type", "keyboard");
url.searchParams.set("keyboardId", "macos");
url.searchParams.set("token", token);

const socket = new WebSocket(url);

const send = (payload) => {
  if (socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify(payload));
};
const sendState = () => send({ type: "keyboard:state", state });
const sendError = (message, forType) =>
  send({ type: "keyboard:error", for: forType, error: message });
const sendDevice = () => {
  if (devicePresent !== null)
    send({ type: "keyboard:device", present: devicePresent });
};

socket.addEventListener("open", () => {
  console.log("connected");
  sendDevice();
});
socket.addEventListener("close", () => console.log("disconnected"));
socket.addEventListener("error", (error) =>
  console.error("websocket error:", error),
);

socket.addEventListener("message", async (event) => {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    console.error("invalid websocket message:", event.data);
    return;
  }

  try {
    if (message.type.startsWith("keyboard:set-") && devicePresent === false) {
      sendError("Keyboard is unplugged.", message.type);
      return;
    }

    switch (message.type) {
      case "keyboard:get-state":
        sendState();
        break;

      case "keyboard:set-effect": {
        const next = {
          ...state,
          effect: message.effect,
          colors:
            message.colors ?? (message.color ? [message.color] : state.colors),
          direction: message.direction ?? state.direction,
          speed: message.speed ?? null,
        };

        const args = buildEffectArgs(next);
        const result = await runRazer(args, message.product);
        if (!result.ok) {
          sendError(result.stderr, message.type);
          break;
        }

        if (
          [
            "static",
            "static-no-store",
            "reactive",
            "breath",
            "starlight",
          ].includes(next.effect)
        ) {
          next.colors = normalizeColors(next.colors, 0, 2);
        }
        state = next;
        await saveState();
        sendState();
        break;
      }

      case "keyboard:set-color": {
        const color = normalizeColor(message.color);
        const result = await runRazer(["--static", color], message.product);
        if (!result.ok) {
          sendError(result.stderr, message.type);
          break;
        }
        state = { ...state, effect: "static", colors: [color], speed: null };
        await saveState();
        sendState();
        break;
      }

      case "keyboard:set-brightness": {
        const brightness = normalizeInt(
          message.brightness,
          0,
          255,
          "brightness",
        );
        const result = await runRazer(
          ["--brightness", String(brightness)],
          message.product,
        );
        if (!result.ok) {
          sendError(result.stderr, message.type);
          break;
        }
        state.brightness = brightness;
        await saveState();
        sendState();
        break;
      }

      // why even have this?
      // case "keyboard:set-logo": {
      //   const logo = message.logo === true || message.logo === 1 ? 1 : 0;
      //   const result = await runRazer(
      //     ["--logo", String(logo)],
      //     message.product,
      //   );
      //   if (!result.ok) {
      //     sendError(result.stderr, message.type);
      //     break;
      //   }
      //   state.logo = logo;
      //   await saveState();
      //   sendState();
      //   break;
      // }

      // TODO:
      // case "keyboard:diagnostics": {
      //   const result = await runRazer(["--list"]);
      //   if (!result.ok && !result.stdout) {
      //     send({ type: "keyboard:diagnostics", error: result.stderr });
      //   } else {
      //     send({
      //       type: "keyboard:diagnostics",
      //       output: result.stdout,
      //       ...(result.ok ? {} : { error: result.stderr }),
      //     });
      //   }
      //   break;
      // }
    }
  } catch (err) {
    console.error(`${message.type} failed:`, err.message);
    sendError(err.message, message.type);
  }
});

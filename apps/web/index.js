const SOCKET_URL = "ws://localhost:6767?type=web";
const HEX = /^[0-9A-F]{6}$/;
const DEFAULT_COLOR = "FF0000";
const COLOR_EFFECTS = new Set(["static", "reactive", "breath", "starlight"]);

const cards = new Map(
  [...document.querySelectorAll(".keyboard-card")].map((card) => [
    card.dataset.keyboardId,
    card,
  ]),
);

const confirmed = new Map();
const messageTimers = new Map();

/* ---------- state <-> data attributes ---------- */

function num(value, fallback) {
  const n = Number(value);
  return value === undefined || value === "" || Number.isNaN(n) ? fallback : n;
}

function readState(card) {
  const d = card.dataset;
  return {
    effect: d.effect || "static",
    colors: d.colors ? d.colors.split(",") : [],
    direction: d.direction === "left" ? "left" : "right",
    speed: d.speed ? Number(d.speed) : null,
    brightness: num(d.brightness, 255),
    logo: num(d.logo, 1),
  };
}

function applyState(card, state) {
  const colors = (Array.isArray(state.colors) ? state.colors : [])
    .map((c) => String(c).toUpperCase())
    .filter((c) => HEX.test(c));

  const d = card.dataset;
  d.effect = state.effect ?? "";
  d.colors = colors.join(",");
  d.color = colors[0] ?? "";
  d.direction = state.direction === "left" ? "left" : "right";
  d.speed = state.speed ?? "";
  d.brightness = String(state.brightness ?? 255);
  d.logo = state.logo === 0 || state.logo === false ? "0" : "1";

  paint(card);
}

function paint(card) {
  const s = readState(card);
  const color = card.dataset.color;

  card.style.setProperty(
    "--glow",
    HEX.test(color) ? `#${color}` : "transparent",
  );
  card.style.setProperty("--brightness", String(s.brightness / 255));

  for (const b of card.querySelectorAll("button[data-color]")) {
    b.setAttribute("aria-pressed", String(b.dataset.color === color));
  }

  for (const b of card.querySelectorAll("button[data-effect]")) {
    const active =
      b.dataset.effect === s.effect &&
      (!b.dataset.direction || b.dataset.direction === s.direction);
    b.setAttribute("aria-pressed", String(active));
  }

  card
    .querySelector('[data-action="logo"]')
    ?.setAttribute("aria-pressed", String(s.logo === 1));

  const slider = card.querySelector('[data-action="brightness"]');
  if (slider) slider.value = String(s.brightness);

  const picker = card.querySelector('[data-action="pick-color"]');
  if (picker && HEX.test(color)) picker.value = `#${color.toLowerCase()}`;
}

function revert(card) {
  const state = confirmed.get(card.dataset.keyboardId);
  if (state) applyState(card, state);
}

/* ---------- messaging ---------- */

let socket = null;
let retries = 0;

function request(card, type, fields = {}) {
  if (socket?.readyState !== WebSocket.OPEN) {
    showMessage(card, "Not connected to the server.");
    return false;
  }

  socket.send(
    JSON.stringify({ type, keyboardId: card.dataset.keyboardId, ...fields }),
  );
  return true;
}

function commit(card, next, type, fields) {
  applyState(card, next);
  if (!request(card, type, fields)) revert(card);
}

function showMessage(card, text) {
  const el = card.querySelector(".message");
  if (!el) return;

  el.textContent = text;
  clearTimeout(messageTimers.get(card));
  messageTimers.set(
    card,
    setTimeout(() => (el.textContent = ""), 5000),
  );
}

function showDiagnostics(card, text) {
  const el = card.querySelector(".diagnostics");
  if (!el) return;

  el.textContent = text;
  el.hidden = false;
}

/* ---------- actions ---------- */

function setEffect(card, patch) {
  const next = { ...readState(card), ...patch };
  const fields = { effect: next.effect };

  if (COLOR_EFFECTS.has(next.effect)) {
    next.colors = [next.colors[0] ?? DEFAULT_COLOR];
    fields.colors = next.colors;
  }

  if (next.effect === "wave") {
    fields.direction = next.direction;
  }

  commit(card, next, "keyboard:set-effect", fields);
}

function setColor(card, color) {
  color = color.replace(/^#/, "").toUpperCase();
  if (!HEX.test(color)) return;

  const { effect } = readState(card);
  setEffect(card, {
    effect: COLOR_EFFECTS.has(effect) ? effect : "static",
    colors: [color],
  });
}

function setBrightness(card, brightness) {
  commit(card, { ...readState(card), brightness }, "keyboard:set-brightness", {
    brightness,
  });
}

function toggleLogo(card) {
  const logo = readState(card).logo === 1 ? 0 : 1;
  commit(card, { ...readState(card), logo }, "keyboard:set-logo", { logo });
}

function runDiagnostics(card) {
  showDiagnostics(card, "Running…");
  if (!request(card, "keyboard:diagnostics")) {
    card.querySelector(".diagnostics").hidden = true;
  }
}

/* ---------- card wiring ---------- */

const template = document.querySelector("#controls-template");

for (const card of cards.values()) {
  card.querySelector(".controls").append(template.content.cloneNode(true));
  paint(card);

  card.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || card.dataset.connected !== "true") return;

    const { color, effect, direction, action } = button.dataset;

    if (color) {
      setColor(card, color);
    } else if (effect) {
      setEffect(card, { effect, ...(direction && { direction }) });
    } else if (action === "logo") {
      toggleLogo(card);
    } else if (action === "diagnostics") {
      runDiagnostics(card);
    }
  });

  card.addEventListener("input", (event) => {
    if (event.target.dataset.action !== "brightness") return;

    card.dataset.brightness = event.target.value;
    paint(card);
  });

  card.addEventListener("change", (event) => {
    if (card.dataset.connected !== "true") return;

    const { action } = event.target.dataset;

    if (action === "brightness") {
      setBrightness(card, Number(event.target.value));
    } else if (action === "pick-color") {
      setColor(card, event.target.value);
    }
  });
}

/* ---------- socket ---------- */

function onMessage(event) {
  let message;

  try {
    message = JSON.parse(event.data);
  } catch {
    console.error("invalid websocket message:", event.data);
    return;
  }

  const card = cards.get(message.keyboardId);

  switch (message.type) {
    case "keyboard:connection": {
      if (!card) return;

      card.dataset.connected = String(message.connected);
      break;
    }

    case "keyboard:state": {
      if (!card || !message.state) return;

      confirmed.set(message.keyboardId, message.state);
      applyState(card, message.state);
      break;
    }

    case "keyboard:error": {
      if (!card) {
        console.error("keyboard error:", message);
        return;
      }

      showMessage(card, message.message ?? "Unknown error.");

      if (message.for === "keyboard:diagnostics") {
        card.querySelector(".diagnostics").hidden = true;
      } else {
        revert(card);
      }
      break;
    }

    case "keyboard:diagnostics": {
      if (!card) return;

      showDiagnostics(card, message.output || message.error || "No output.");
      break;
    }

    case "error": {
      console.error("server error:", message.message);
      break;
    }
  }
}

function connect() {
  socket = new WebSocket(SOCKET_URL);

  socket.addEventListener("open", () => {
    retries = 0;
    console.log("connected");
  });

  socket.addEventListener("close", (event) => {
    console.log(`Connection closed, reason: "${event.reason}"`);

    for (const card of cards.values()) card.dataset.connected = "false";

    if (event.code !== 1008) {
      setTimeout(connect, Math.min(1000 * 2 ** retries++, 10000));
    }
  });

  socket.addEventListener("error", (event) => console.log("error", event));
  socket.addEventListener("message", onMessage);
}

connect();

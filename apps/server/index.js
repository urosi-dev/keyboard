import { WebSocketServer, WebSocket } from "ws";

const PORT = 6767;
const WEB_ORIGINS = new Set(["http://localhost:8000", "http://[::1]:8000"]);

const wss = new WebSocketServer({ port: PORT });
const keyboardClients = new Map();
const webClients = new Set();

const WEB_TO_KEYBOARD = {
  "keyboard:set-effect": [
    "effect",
    "colors",
    "color",
    "direction",
    "speed",
    "product",
  ],
  "keyboard:set-color": ["color", "product"],
  "keyboard:set-brightness": ["brightness", "product"],
  "keyboard:set-logo": ["logo", "product"],
  "keyboard:diagnostics": [],
};

function send(socket, type, data = {}) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify({ type, ...data }));
}

function broadcast(type, data = {}) {
  const message = JSON.stringify({ type, ...data });

  console.log("broadcast", message);

  for (const client of webClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function pick(source, keys) {
  const out = {};

  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }

  return out;
}

function parseMessage(socket, raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    send(socket, "error", { message: "Invalid JSON." });
    return null;
  }
}

function authenticateKeyboard(keyboardId, token) {
  if (!keyboardId) return "Missing keyboardId.";
  if (!token) return "Missing keyboard token.";

  const expectedToken =
    process.env[`KEYBOARD_${keyboardId.toUpperCase()}_TOKEN`];

  if (!expectedToken || token !== expectedToken) {
    return "Invalid keyboard token.";
  }

  return null;
}

function authenticateWeb(request) {
  const origin = request.headers.origin;

  if (!origin) {
    return "Missing origin.";
  }

  if (!WEB_ORIGINS.has(origin)) {
    return "Invalid origin.";
  }

  return null;
}

wss.on("listening", () => {
  console.log(`WebSocket server listening on ws://localhost:${PORT}`);
});

wss.on("connection", (socket, request) => {
  const url = new URL(request.url, "http://localhost");

  const type = url.searchParams.get("type");

  if (type === "keyboard") {
    const keyboardId = url.searchParams.get("keyboardId");
    const token = url.searchParams.get("token");

    const error = authenticateKeyboard(keyboardId, token);

    if (error) {
      console.error(`Keyboard authentication failed: ${error}`);

      send(socket, "error", {
        message: error,
      });

      socket.close(1008, error);
      return;
    }

    socket.keyboardId = keyboardId;
    socket.clientType = "keyboard";

    const existingClient = keyboardClients.get(keyboardId);

    if (existingClient) {
      existingClient.close(1000, "Replaced by new connection.");
    }

    keyboardClients.set(keyboardId, socket);

    console.log(`keyboard connected: ${keyboardId}`);

    broadcast("keyboard:connection", { keyboardId, connected: true });

    socket.on("message", (raw) => {
      const message = parseMessage(socket, raw);
      if (!message) return;

      switch (message.type) {
        case "keyboard:device":
          socket.devicePresent = Boolean(message.present);
          broadcast("keyboard:connection", {
            keyboardId,
            connected: socket.devicePresent,
          });
          break;
        case "keyboard:state":
          broadcast("keyboard:state", {
            keyboardId,
            state: message.state,
          });
          break;

        case "keyboard:error":
          broadcast("keyboard:error", {
            keyboardId,
            for: message.for,
            message: message.error ?? message.message ?? "Unknown error.",
          });
          break;

        case "keyboard:diagnostics":
          broadcast("keyboard:diagnostics", {
            keyboardId,
            output: message.output,
            error: message.error,
          });
          break;
      }
    });

    socket.on("close", () => {
      if (keyboardClients.get(keyboardId) !== socket) {
        return;
      }

      keyboardClients.delete(keyboardId);

      console.log(`keyboard disconnected: ${keyboardId}`);

      broadcast("keyboard:connection", {
        keyboardId,
        connected: false,
      });
    });

    return;
  }

  if (type === "web") {
    const error = authenticateWeb(request);

    if (error) {
      console.error(`Web authentication failed: ${error}`);
      send(socket, "error", { message: error });
      socket.close(1008, error);
      return;
    }

    socket.clientType = "web";
    webClients.add(socket);

    console.log(`web client connected: ${request.headers.origin}`);

    for (const [keyboardId, keyboard] of keyboardClients) {
      send(keyboard, "keyboard:get-state");
      send(socket, "keyboard:connection", {
        keyboardId,
        connected: keyboard.devicePresent !== false,
      });
    }

    socket.on("message", (raw) => {
      const message = parseMessage(socket, raw);
      if (!message) return;

      const allowedFields = WEB_TO_KEYBOARD[message.type];

      if (!allowedFields) {
        send(socket, "error", {
          message: `Unknown message type '${message.type}'.`,
        });
        return;
      }

      const { keyboardId } = message;
      const client = keyboardClients.get(keyboardId);

      if (!client) {
        send(socket, "keyboard:error", {
          keyboardId,
          for: message.type,
          message: "Keyboard is not connected.",
        });
        return;
      }

      if (client.devicePresent === false) {
        send(socket, "keyboard:error", {
          keyboardId,
          for: message.type,
          message: "Keyboard is unplugged.",
        });
        return;
      }

      send(client, message.type, pick(message, allowedFields));
    });

    socket.on("close", () => {
      webClients.delete(socket);
      console.log("web client disconnected");
    });

    return;
  }

  socket.close(1008, "Unknown client type.");
});

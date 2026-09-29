import { io } from "./server.js";
// import { findUser, updateUserStatus, updateUserColor } from "./queries.js";
import {
  findUser,
  updateUserStatus,
  updateUserColor,
  getAllUsers,
} from "./queries-csv.js";

export const keyboards = new Map([]);

async function init() {
  const data = await getAllUsers();
  for (const user of data) {
    keyboards.set(user.id, {
      color: user.color,
      connected: false,
    });
  }
}

await init();

function isKeyboardClient(socket) {
  return socket.handshake.headers["user-agent"] === "node-XMLHttpRequest";
}

io.use(async (socket, next) => {
  if (!isKeyboardClient(socket)) return next();

  const { sessionID } = socket.handshake.auth;
  if (!sessionID) return next(new Error("Missing sessionID."));

  const user = await findUser(sessionID);

  if (!user || !user.id || !user.color) {
    return next(new Error("Keyboard not found."));
  }
  if (user.id) {
    socket.keyboardID = user.id;
    socket.color = user.color;
    return next();
  }

  next();
});

io.on("connection", async (socket) => {
  const id = socket.keyboardID;

  if (isKeyboardClient(socket)) {
    await updateUserStatus(id, true);
    keyboards.set(id, { ...keyboards.get(id), connected: true });
    console.log("user connected:", id);
  }

  console.log({ ...keyboards.get(id) });
  socket.broadcast.emit("status", { ...keyboards.get(id), id });

  socket.on("color", async (payload) => {
    const targetId = payload.split("-")[1];
    const color = payload.split("-")[0];

    const { color: updatedColor } = await updateUserColor(targetId, color);

    keyboards.set(targetId, {
      ...keyboards.get(targetId),
      color: updatedColor,
    });

    socket.broadcast.emit("status", {
      ...keyboards.get(targetId),
      id: targetId,
    });
  });

  socket.on("disconnect", async () => {
    if (isKeyboardClient(socket)) {
      await updateUserStatus(id, false);
      console.log("user disconnected:", id);
      keyboards.set(id, { ...keyboards.get(id), connected: false });
    }

    socket.broadcast.emit("status", { ...keyboards.get(id), id });
  });
});

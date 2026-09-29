import { io } from "socket.io-client";
import { ids } from "./main";

export const socket = io({
  auth: { sessionID: import.meta.env.VITE_ID },
});

const colors = new Map([
  ["red", "bg-red-600"],
  ["green", "bg-green-600"],
  ["blue", "bg-blue-800"],
]);

socket.on("connect_error", (err) => {
  console.error(err.message);
});

socket.on("color", (color) => {
  console.log("color", color);
});

socket.on("status", (status) => {
  if (!status) return;

  const id = status.id;
  const connected = status.connected;

  console.log("status", status);

  if (connected) {
    const buttons = ids
      .filter((i) => i.split("-")[1] === id)
      .map((i) => document.getElementById(i));
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }

  document
    .getElementById(`card-${id}`)
    .classList.toggle("opacity-30", !connected);

  if (connected) {
    document.getElementById(`color-${id}`).className = `${colors.get(
      status.color,
    )} inset-[-7px] absolute -z-10 blur-sm transition duration-300`;
  } else {
    document.getElementById(`color-${id}`).className =
      "inset-[-7px] absolute -z-10 blur-sm transition duration-300";
  }

  const pingOuterClasses =
    " absolute inline-flex h-full w-full rounded-full opacity-75";
  document.getElementById(`pingOuter-${status.id}`).classList = status.connected
    ? "animate-ping bg-green-500" + pingOuterClasses
    : "bg-zinc-500" + pingOuterClasses;

  const pingInnerClasses = " relative inline-flex rounded-full h-2 w-2";

  document.getElementById(`pingInner-${status.id}`).classList = status.connected
    ? "bg-green-500" + pingInnerClasses
    : "bg-zinc-500" + pingInnerClasses;
});

export function updateColor(id) {
  const button = document.getElementById(id);

  button.addEventListener("click", () => {
    const index = id.split("-")[1];
    const color = id.split("-")[0];

    document.getElementById(`color-${index}`).className = `${colors.get(
      color,
    )} inset-[-7px] absolute -z-10 blur-sm transition duration-[4000ms]`;

    socket.emit("color", id);
    console.log("color", color);
  });
}

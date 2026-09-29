import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import ViteExpress from "vite-express";
// import { createAdapter } from "@socket.io/postgres-adapter";
// import { pool } from "./queries.js";

const app = express();
const httpServer = createServer(app);

export const io = new Server(httpServer, {
  allowEIO3: true,
  cors: {
    credentials: true,
    origin: [
      "http://localhost:3000",
      "ws://localhost:24678",
      "ws://localhost:3000",
    ],
  },
});

// io.adapter(createAdapter(pool));

const server = httpServer.listen(3000, () => {
  console.log("server listening at http://localhost:3000");
});

ViteExpress.bind(app, server);

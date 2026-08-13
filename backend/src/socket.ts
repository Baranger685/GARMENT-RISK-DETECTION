import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

let io: SocketIOServer | null = null;

export function initSocket(httpServer: HttpServer, frontendUrl: string): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: frontendUrl,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    // eslint-disable-next-line no-console
    console.log(`[socket] client connected: ${socket.id}`);

    socket.on("join:line", (line: string) => {
      socket.join(`line:${line}`);
    });

    // Employees join their own private room after PIN login so a
    // flagged-worker notification can be pushed straight to their own
    // dashboard in real time.
    socket.on("join:employee", (workerId: number) => {
      socket.join(`employee:${workerId}`);
    });

    socket.on("acknowledge:alert", (alertId: number) => {
      // Broadcast so every connected dashboard reflects the ack instantly.
      io?.emit("alert:acknowledged", { alertId });
    });

    socket.on("disconnect", () => {
      // eslint-disable-next-line no-console
      console.log(`[socket] client disconnected: ${socket.id}`);
    });
  });

  return io;
}

export function getIo(): SocketIOServer {
  if (!io) throw new Error("Socket.IO has not been initialized yet");
  return io;
}

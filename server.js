const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT || 8000);
const MAX_PLAYERS = 10;

const app = express();
app.use(express.static(path.join(__dirname)));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function roomSize(room) {
  let count = 0;
  room.clients.forEach(() => {
    count += 1;
  });
  return count;
}

function broadcast(roomCode, payload, excludeWs = null) {
  const room = rooms.get(roomCode);
  if (!room) return;
  room.clients.forEach((client) => {
    if (excludeWs && client === excludeWs) return;
    send(client, payload);
  });
}

function removeFromRoom(ws, reason = "leave") {
  const meta = ws.meta || {};
  if (!meta.roomCode) return;

  const room = rooms.get(meta.roomCode);
  if (!room) return;

  room.clients.delete(ws);

  if (meta.playerId) {
    broadcast(
      meta.roomCode,
      {
        type: "leave",
        roomCode: meta.roomCode,
        playerId: meta.playerId,
        reason,
      },
      ws,
    );
  }

  const hasPlayers = roomSize(room) > 0;
  const hostLeft = meta.playerId && meta.playerId === room.hostPlayerId;

  if (hostLeft) {
    broadcast(meta.roomCode, {
      type: "room-closed",
      roomCode: meta.roomCode,
      message: "Host disconnected",
    });
    rooms.delete(meta.roomCode);
  } else if (!hasPlayers) {
    rooms.delete(meta.roomCode);
  }

  ws.meta = {};
}

wss.on("connection", (ws) => {
  ws.meta = {};

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (!msg || !msg.type) return;

    if (msg.type === "create-room") {
      if (!msg.roomCode || !msg.playerId) return;
      if (rooms.has(msg.roomCode)) {
        send(ws, { type: "room-error", message: "Room code collision. Try again." });
        return;
      }
      const room = {
        code: msg.roomCode,
        hostPlayerId: msg.playerId,
        clients: new Set(),
      };
      room.clients.add(ws);
      rooms.set(msg.roomCode, room);
      ws.meta = { roomCode: msg.roomCode, playerId: msg.playerId, playerName: msg.playerName || "Host" };
      send(ws, { type: "room-created", roomCode: msg.roomCode });
      return;
    }

    if (msg.type === "join-room") {
      const room = rooms.get(msg.roomCode);
      if (!room) {
        send(ws, { type: "room-error", message: "Room not found" });
        return;
      }

      if (roomSize(room) >= MAX_PLAYERS) {
        send(ws, { type: "room-error", message: "Room is full" });
        return;
      }

      room.clients.add(ws);
      ws.meta = { roomCode: msg.roomCode, playerId: msg.playerId, playerName: msg.playerName || "Player" };

      send(ws, { type: "joined-room", roomCode: msg.roomCode });
      broadcast(
        msg.roomCode,
        {
          type: "join-request",
          roomCode: msg.roomCode,
          player: {
            id: msg.playerId,
            name: msg.playerName || "Player",
            isHost: false,
            connected: true,
            ready: false,
            ai: false,
            hand: [],
            score: 0,
            unoCalled: false,
            unoDeadline: 0,
            forfeits: 0,
            disconnectedAt: null,
          },
        },
        ws,
      );
      return;
    }

    if (msg.type === "leave-room") {
      removeFromRoom(ws, "leave");
      return;
    }

    const meta = ws.meta || {};
    if (!meta.roomCode || meta.roomCode !== msg.roomCode) return;

    if (msg.type === "action" || msg.type === "chat" || msg.type === "state-sync") {
      broadcast(meta.roomCode, msg, null);
    }
  });

  ws.on("close", () => {
    removeFromRoom(ws, "disconnect");
  });
});

server.listen(PORT, () => {
  console.log(`UNO server listening on http://0.0.0.0:${PORT}`);
});

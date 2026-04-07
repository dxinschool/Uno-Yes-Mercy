# Uno No Mercy

Uno No Mercy is a premium-looking multiplayer UNO clone with a custom rule set, realtime room sync, and a polished glassmorphism UI.

## Features

- Create or join rooms with a room code.
- Host-authoritative multiplayer over WebSocket.
- Ready toggle and lobby player list.
- Turn timer, chat, game log, and winner dialog.
- No Mercy rule set, including stacking, 7 swap, 0 rotation, UNO catch, and discard-all behavior.
- Click-to-play or multi-select play mode.
- Responsive layout for desktop and mobile.

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open the app in your browser at the local URL printed by the server.

## Online Multiplayer

The game uses a WebSocket server. For online play, host `server.js` on a service that supports long-running Node processes, then point the client at that WebSocket URL.

If you open the standalone clone page, use a query string such as:

```text
?server=wss://your-server.example
```

## Project Files

- `index.html` - main client UI.
- `script.js` - game logic and WebSocket client.
- `styles.css` - premium theme and responsive layout.
- `server.js` - room and sync server.

## Notes

- The project is designed to run as a small Node app.
- The clone page at `Uno-Yes-Mercy.html` uses the same app assets and can be pointed at a remote WebSocket server.
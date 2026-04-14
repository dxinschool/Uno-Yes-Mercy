const STORAGE_KEY = "uno-no-mercy-player";
const STORAGE_SERVER_KEY = "uno-no-mercy-server-url";
const STORAGE_PLAY_MODE_KEY = "uno-no-mercy-play-mode";
const MAX_PLAYERS = 10;
const UNO_GRACE_MS = 2000;

const COLORS = ["red", "blue", "green", "yellow"];
const DEFAULT_SERVER_URL = "wss://uno-yes-mercy.onrender.com";
const VALUE_LABELS = {
  skip: "S",
  reverse: "R",
  draw2: "+2",
  draw4: "+4",
  draw6: "+6",
  draw10: "+10",
  discardall: "DA",
  skipeveryone: "SE",
  wild: "W",
  wildreverse4: "WR+4",
  wilddraw6: "W+6",
  wilddraw10: "W+10",
  wild4: "+4",
};

const DRAW_VALUES = new Map([
  ["draw2", 2],
  ["draw4", 4],
  ["draw6", 6],
  ["draw10", 10],
  ["wildreverse4", 4],
  ["wild4", 4],
]);

const WILD_COLOR_CHOOSERS = new Set(["wild", "wildreverse4", "wild4"]);

let playerProfile = loadProfile();
let serverUrl = loadServerUrl();
let playMode = loadPlayMode();
let state = null;
let socket = null;
let socketOpen = false;
let hostTicker = null;
let selectedCards = new Set();
let timerAnimFrame = null;

const el = {
  lobbyView: document.getElementById("lobbyView"),
  gameView: document.getElementById("gameView"),
  playerName: document.getElementById("playerName"),
  serverUrlInput: document.getElementById("serverUrlInput"),
  saveNameBtn: document.getElementById("saveNameBtn"),
  saveServerBtn: document.getElementById("saveServerBtn"),
  networkStatus: document.getElementById("networkStatus"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  lobbyStatus: document.getElementById("lobbyStatus"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  phaseLabel: document.getElementById("phaseLabel"),
  playerStrip: document.getElementById("playerStrip"),
  leftOpponents: document.getElementById("leftOpponents"),
  rightOpponents: document.getElementById("rightOpponents"),
  drawPile: document.getElementById("drawPile"),
  drawCount: document.getElementById("drawCount"),
  discardCard: document.getElementById("discardCard"),
  roomCodeBoxes: Array.from(document.querySelectorAll("[data-room-code-box]")),
  currentColorLabel: document.getElementById("currentColorLabel"),
  pendingDrawLabel: document.getElementById("pendingDrawLabel"),
  turnLabel: document.getElementById("turnLabel"),
  readyBtn: document.getElementById("readyBtn"),
  startBtn: document.getElementById("startBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  handArea: document.getElementById("handArea"),
  playBtn: document.getElementById("playBtn"),
  drawBtn: document.getElementById("drawBtn"),
  unoBtn: document.getElementById("unoBtn"),
  catchUnoBtn: document.getElementById("catchUnoBtn"),
  clickPlayModeBtn: document.getElementById("clickPlayModeBtn"),
  multiSelectModeBtn: document.getElementById("multiSelectModeBtn"),
  chatList: document.getElementById("chatList"),
  logList: document.getElementById("logList"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn"),
  turnTimerBar: document.getElementById("turnTimerBar"),
  colorChoiceDialog: document.getElementById("colorChoiceDialog"),
  winnerDialog: document.getElementById("winnerDialog"),
  winnerTitle: document.getElementById("winnerTitle"),
  winnerSubtitle: document.getElementById("winnerSubtitle"),
  closeWinnerBtn: document.getElementById("closeWinnerBtn"),
};

bootstrap();

function bootstrap() {
  el.playerName.value = playerProfile.name;
  el.serverUrlInput.value = serverUrl;
  bindEvents();
  ensureSocket();
  render();
  window.addEventListener("beforeunload", () => {
    if (state && socketOpen) {
      sendNetwork({
        type: "leave-room",
        roomCode: state.roomCode,
        playerId: playerProfile.id,
      });
    }
  });
}

function bindEvents() {
  el.saveNameBtn.addEventListener("click", () => {
    const name = sanitizeName(el.playerName.value);
    playerProfile.name = name;
    saveProfile();
    setLobbyStatus(`Saved as ${name}`);
  });

  el.saveServerBtn.addEventListener("click", () => {
    const next = sanitizeServerUrl(el.serverUrlInput.value);
    if (!next) {
      setLobbyStatus("Server URL must start with ws:// or wss://");
      return;
    }
    serverUrl = next;
    saveServerUrl(serverUrl);
    reconnectSocket();
    setLobbyStatus(`Server saved: ${serverUrl}`);
  });

  el.createRoomBtn.addEventListener("click", createRoom);
  el.joinRoomBtn.addEventListener("click", () => joinRoom((getRoomCodeFromBoxes() || el.roomCodeInput.value).trim().toUpperCase()));

  el.readyBtn.addEventListener("click", () => sendAction({ type: "toggle-ready" }));
  el.startBtn.addEventListener("click", () => sendAction({ type: "start-game" }));
  el.leaveBtn.addEventListener("click", leaveRoom);

  el.playBtn.addEventListener("click", playSelectedCards);
  el.drawBtn.addEventListener("click", () => sendAction({ type: "draw-card" }));
  el.unoBtn.addEventListener("click", () => sendAction({ type: "call-uno" }));
  el.catchUnoBtn.addEventListener("click", catchUnoCandidate);

  el.colorChoiceDialog?.addEventListener("cancel", (event) => {
    if (isAwaitingColorChoiceForSelf()) {
      event.preventDefault();
    }
  });

  el.colorChoiceDialog?.querySelectorAll("[data-color-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.getAttribute("data-color-choice");
      if (color) sendAction({ type: "choose-color", color });
    });
  });

  el.clickPlayModeBtn.addEventListener("click", () => setPlayMode("single"));
  el.multiSelectModeBtn.addEventListener("click", () => setPlayMode("multi"));

  el.drawPile.addEventListener("click", () => sendAction({ type: "draw-card" }));

  el.chatSendBtn.addEventListener("click", sendChat);
  el.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });

  el.closeWinnerBtn.addEventListener("click", () => {
    el.winnerDialog.close();
    leaveRoom();
  });

  setupRoomCodeBoxes();
}

function createRoom() {
  if (!socketOpen) {
    ensureSocket();
    setLobbyStatus("Connecting to server... try again in a moment.");
    return;
  }

  const roomCode = generateRoomCode();
  const host = makePlayer(playerProfile.id, playerProfile.name, true);
  state = {
    roomCode,
    hostId: host.id,
    phase: "lobby",
    version: 1,
    players: [host],
    deck: [],
    discardPile: [],
    currentColor: null,
    currentPlayerIndex: 0,
    direction: 1,
    pendingDraw: 0,
    pendingType: null,
    pendingMinDrawValue: 0,
    colorChoicePlayerId: null,
    colorChoiceMode: null,
    skipChain: 0,
    logs: [logLine("System", `Room ${roomCode} created`)],
    chat: [],
    winnerId: null,
    turnSeconds: 30,
    turnDeadline: 0,
  };
  sendNetwork({
    type: "create-room",
    roomCode,
    playerId: playerProfile.id,
    playerName: playerProfile.name,
  });
  publishState();
  render();
}

function joinRoom(roomCode) {
  if (!roomCode || roomCode.length < 4) {
    setLobbyStatus("Invalid room code");
    return;
  }

  if (!socketOpen) {
    ensureSocket();
    setLobbyStatus("Connecting to server... try again in a moment.");
    return;
  }

  sendNetwork({
    type: "join-room",
    roomCode,
    playerId: playerProfile.id,
    playerName: playerProfile.name,
  });

  setLobbyStatus(`Joining ${roomCode}...`);
  const joinTimeout = setTimeout(() => {
    if (!state || state.roomCode !== roomCode) {
      setLobbyStatus("Join failed. Verify room code and host availability.");
    }
  }, 1800);

  const cancelWatcher = () => {
    clearTimeout(joinTimeout);
    window.removeEventListener("uno-joined", cancelWatcher);
  };
  window.addEventListener("uno-joined", cancelWatcher);
}

function setupRoomCodeBoxes() {
  if (!el.roomCodeBoxes || el.roomCodeBoxes.length === 0) return;

  el.roomCodeBoxes.forEach((box, index) => {
    box.addEventListener("input", () => {
      const value = sanitizeRoomCodeChar(box.value);
      box.value = value;
      if (value && index < el.roomCodeBoxes.length - 1) {
        el.roomCodeBoxes[index + 1].focus();
      }
      syncRoomCodeHidden();
    });

    box.addEventListener("keydown", (event) => {
      if (event.key === "Backspace" && !box.value && index > 0) {
        el.roomCodeBoxes[index - 1].focus();
        el.roomCodeBoxes[index - 1].value = "";
        syncRoomCodeHidden();
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowLeft" && index > 0) {
        el.roomCodeBoxes[index - 1].focus();
        event.preventDefault();
        return;
      }

      if (event.key === "ArrowRight" && index < el.roomCodeBoxes.length - 1) {
        el.roomCodeBoxes[index + 1].focus();
        event.preventDefault();
      }
    });

    box.addEventListener("paste", (event) => {
      event.preventDefault();
      const text = event.clipboardData ? event.clipboardData.getData("text") : "";
      fillRoomCodeBoxes(text);
    });
  });

  syncRoomCodeHidden();
}

function syncRoomCodeHidden() {
  if (!el.roomCodeInput) return;
  el.roomCodeInput.value = getRoomCodeFromBoxes();
}

function fillRoomCodeBoxes(text) {
  const chars = String(text || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, el.roomCodeBoxes.length)
    .split("");

  el.roomCodeBoxes.forEach((box, index) => {
    box.value = chars[index] || "";
  });

  syncRoomCodeHidden();
  const nextEmpty = el.roomCodeBoxes.find((box) => !box.value);
  if (nextEmpty) nextEmpty.focus();
}

function getRoomCodeFromBoxes() {
  return (el.roomCodeBoxes || [])
    .map((box) => sanitizeRoomCodeChar(box.value))
    .join("");
}

function ensureSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  socket = new WebSocket(serverUrl);
  socketOpen = false;
  setNetworkStatus("Connecting...");

  socket.addEventListener("open", () => {
    socketOpen = true;
    setNetworkStatus(`Connected to ${serverUrl}`);
  });

  socket.addEventListener("close", () => {
    socketOpen = false;
    setNetworkStatus("Disconnected");
    if (state) {
      setLobbyStatus("Connection lost. Reconnect and rejoin room.");
    }
  });

  socket.addEventListener("error", () => {
    socketOpen = false;
    setNetworkStatus("Connection error");
  });

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      onNetworkMessage(msg);
    } catch {
      // Ignore malformed packets.
    }
  });
}

function reconnectSocket() {
  if (socket) {
    socket.close();
  }
  ensureSocket();
}

function sendNetwork(payload) {
  if (!socketOpen || !socket) return;
  socket.send(JSON.stringify(payload));
}

function onNetworkMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === "room-created") {
    setLobbyStatus(`Room ${msg.roomCode} created`);
    return;
  }

  if (msg.type === "joined-room") {
    setLobbyStatus(`Joined ${msg.roomCode}, waiting for host sync...`);
    return;
  }

  if (msg.type === "room-error") {
    setLobbyStatus(msg.message || "Room error");
    return;
  }

  if (msg.type === "room-closed") {
    if (state && msg.roomCode === state.roomCode) {
      setLobbyStatus("Host disconnected. Room closed.");
      leaveRoom();
    }
    return;
  }

  if (msg.type === "join-request" && isHost()) {
    hostHandleJoin(msg.player);
    return;
  }

  if (msg.type === "leave" && isHost() && state) {
    hostHandleLeave(msg.playerId);
    return;
  }

  if (msg.type === "action" && isHost() && state) {
    hostApplyAction(msg.playerId, msg.action);
    return;
  }

  if (msg.type === "chat" && isHost() && state) {
    hostPushChat(msg.playerId, msg.text);
    return;
  }

  if (msg.type === "state-sync") {
    const shouldApply = !state || msg.state.version >= state.version;
    if (!shouldApply) return;
    const prevRoom = state ? state.roomCode : null;
    state = msg.state;
    if (prevRoom !== state.roomCode) {
      window.dispatchEvent(new Event("uno-joined"));
    }
    if (state.phase === "ended" && state.winnerId) {
      showWinner();
    }
    render();
  }
}

function hostHandleJoin(player) {
  if (!state || state.phase === "ended") return;

  const existing = state.players.find((p) => p.id === player.id);
  if (existing) {
    existing.connected = true;
    existing.ai = false;
    existing.disconnectedAt = null;
    existing.name = player.name;
    addLog(`${existing.name} reconnected`);
    publishState();
    return;
  }

  if (state.players.length >= MAX_PLAYERS) {
    return;
  }

  state.players.push(player);
  addLog(`${player.name} joined room`);
  publishState();
}

function hostHandleLeave(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  p.connected = false;
  p.disconnectedAt = Date.now();
  addLog(`${p.name} disconnected (60s reconnect window)`);
  publishState();
}

function sendAction(action) {
  if (!state || !socketOpen) return;
  if (isHost()) {
    hostApplyAction(playerProfile.id, action);
    return;
  }
  sendNetwork({
    type: "action",
    roomCode: state.roomCode,
    playerId: playerProfile.id,
    action,
  });
}

function sendChat() {
  if (!state || !socketOpen) return;
  const text = el.chatInput.value.trim();
  if (!text) return;

  if (isHost()) {
    hostPushChat(playerProfile.id, text);
  } else {
    sendNetwork({
      type: "chat",
      roomCode: state.roomCode,
      playerId: playerProfile.id,
      text,
    });
  }
  el.chatInput.value = "";
}

function hostPushChat(playerId, text) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return;
  state.chat.push({
    id: crypto.randomUUID(),
    playerId,
    name: p.name,
    text: text.slice(0, 180),
    ts: Date.now(),
    type: "player",
  });
  state.chat = state.chat.slice(-80);
  publishState();
}

function playSelectedCards() {
  if (!state) return;
  const self = getSelf();
  const top = getTopCard();
  let cards = [...selectedCards];

  if (playMode === "single" && cards.length === 0 && self) {
    const fallbackCard = self.hand.find((card) => canPlayCard(card, self, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue));
    if (fallbackCard) {
      cards = [fallbackCard.id];
    }
  }

  if (cards.length === 0) {
    setLobbyStatus("Select at least one card");
    return;
  }
  sendAction({ type: "play-cards", cardIds: cards });
  selectedCards.clear();
}

function catchUnoCandidate() {
  if (!state) return;
  const now = Date.now();
  const target = state.players.find(
    (p) => p.id !== playerProfile.id && p.hand.length === 1 && !p.unoCalled && p.unoDeadline && now <= p.unoDeadline + 6000,
  );
  if (!target) {
    setLobbyStatus("No catchable UNO target");
    return;
  }
  sendAction({ type: "catch-uno", targetId: target.id });
}

function hostApplyAction(playerId, action) {
  if (!state || !action) return;
  const actor = state.players.find((p) => p.id === playerId);
  if (!actor || !actor.connected) return;

  switch (action.type) {
    case "toggle-ready":
      if (state.phase !== "lobby") break;
      actor.ready = !actor.ready;
      addLog(`${actor.name} is ${actor.ready ? "ready" : "not ready"}`);
      break;

    case "start-game":
      if (playerId !== state.hostId || state.phase !== "lobby") break;
      startGame();
      break;

    case "play-cards":
      if (state.phase !== "playing") break;
      playCardsAction(playerId, action.cardIds || []);
      break;

    case "draw-card":
      if (state.phase !== "playing") break;
      drawCardAction(playerId);
      break;

    case "call-uno":
      if (state.phase !== "playing") break;
      callUnoAction(playerId);
      break;

    case "catch-uno":
      if (state.phase !== "playing") break;
      catchUnoAction(playerId, action.targetId);
      break;

    case "swap-hand":
      if (state.phase !== "playing") break;
      swapHandsAction(playerId, action.targetId);
      break;

    case "choose-color":
      if (state.phase !== "playing") break;
      chooseColorAction(playerId, action.color);
      break;

    case "skip-afk":
      if (playerId !== state.hostId || state.phase !== "playing") break;
      timeoutAdvance("Host skipped AFK turn");
      break;

    default:
      break;
  }

  publishState();
}

function startGame() {
  const readyPlayers = state.players.filter((p) => p.ready || p.isHost);
  if (readyPlayers.length < 2) {
    addLog("Need at least 2 ready players");
    return;
  }

  state.players = state.players.map((p) => ({
    ...p,
    hand: [],
    unoCalled: false,
    unoDeadline: 0,
    forfeits: p.forfeits || 0,
    connected: p.connected !== false,
    ai: false,
  }));

  state.deck = buildDeck();
  shuffle(state.deck);

  for (let i = 0; i < 7; i += 1) {
    state.players.forEach((p) => {
      p.hand.push(state.deck.pop());
    });
  }

  let top = state.deck.pop();
  while (isSetupIgnoredCard(top)) {
    state.deck.unshift(top);
    shuffle(state.deck);
    top = state.deck.pop();
  }

  state.discardPile = [top];
  state.currentColor = top.color === "wild" ? COLORS[Math.floor(Math.random() * COLORS.length)] : top.color;
  state.currentPlayerIndex = 0;
  state.direction = 1;
  state.pendingDraw = 0;
  state.pendingType = null;
  state.pendingMinDrawValue = 0;
  state.colorChoicePlayerId = null;
  state.colorChoiceMode = null;
  state.colorChoiceCardValue = null;
  state.skipChain = 0;
  state.phase = "playing";
  state.winnerId = null;
  resetTurnDeadline();
  addLog("Game started");
}

function playCardsAction(playerId, cardIds) {
  const actorIndex = state.players.findIndex((p) => p.id === playerId);
  const actor = state.players[actorIndex];
  if (!actor || cardIds.length === 0) return;
  if (state.colorChoicePlayerId === playerId) return;

  const inTurn = state.players[state.currentPlayerIndex]?.id === playerId;
  const top = getTopCard();

  const chosen = cardIds
    .map((id) => actor.hand.find((c) => c.id === id))
    .filter(Boolean);

  if (chosen.length !== cardIds.length) return;

  const first = chosen[0];
  if (chosen.length > 1) {
    addLog(`${actor.name} attempted invalid multi-card play`);
    return;
  }

  if (!inTurn) {
    if (!isExactMatchJumpIn(first, top)) {
      addLog(`${actor.name} attempted invalid jump-in`);
      return;
    }
    state.currentPlayerIndex = actorIndex;
    addLog(`${actor.name} jumped in!`);
  }

  if (!canPlayCard(first, actor, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue)) {
    addLog(`${actor.name} attempted invalid card`);
    return;
  }

  const discardCard = (card) => {
    const idx = actor.hand.findIndex((c) => c.id === card.id);
    if (idx >= 0) {
      actor.hand.splice(idx, 1);
      state.discardPile.push(card);
      if (!isWildCard(card)) state.currentColor = card.color;
    }
  };

  chosen.forEach(discardCard);

  const discardAllCard = chosen.find((card) => card.value === "discardall");
  if (discardAllCard) {
    const matchingCards = [...actor.hand].filter((card) => card.color === discardAllCard.color);
    matchingCards.forEach(discardCard);
    addLog(`${actor.name} discarded all ${discardAllCard.color} cards`);
  }

  chosen.filter((card) => card.value !== "discardall").forEach((card) => applyCardImmediateEffect(card, playerId, false));

  addLog(`${actor.name} played ${chosen.map(cardShort).join(" ")}`);

  const requiresSelfChoice = isWildCard(first) && first.value !== "wild";
  if (requiresSelfChoice) {
    state.colorChoicePlayerId = playerId;
    state.colorChoiceMode = "self";
    state.colorChoiceCardValue = first.value;
  }

  if (actor.hand.length === 0 && !requiresSelfChoice) {
    finishRound(actor.id);
    return;
  }

  if (actor.hand.length === 1) {
    actor.unoCalled = false;
    actor.unoDeadline = Date.now() + UNO_GRACE_MS;
    addLog(`${actor.name} has one card!`);
  } else {
    actor.unoCalled = false;
    actor.unoDeadline = 0;
  }

  if (requiresSelfChoice) {
    return;
  }

  advanceTurnAfterPlay(chosen[chosen.length - 1], playerId);
}

function drawCardAction(playerId) {
  if (state.players[state.currentPlayerIndex]?.id !== playerId) return;
  if (state.colorChoicePlayerId) return;
  const actor = state.players.find((p) => p.id === playerId);

  if (state.pendingDraw > 0) {
    dealCards(actor, state.pendingDraw);
    addLog(`${actor.name} drew ${state.pendingDraw}`);
    state.pendingDraw = 0;
    state.pendingType = null;
    state.pendingMinDrawValue = 0;
    nextPlayer();
    resetTurnDeadline();
    return;
  }

  if (hasPlayableCard(actor)) {
    addLog(`${actor.name} tried to draw with a playable card in hand`);
    return;
  }

  const played = drawUntilPlayableAndPlay(actor);
  if (!played) {
    addLog(`${actor.name} drew 1`);
    nextPlayer();
    resetTurnDeadline();
  }
}

function callUnoAction(playerId) {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.hand.length !== 1) return;
  p.unoCalled = true;
  p.unoDeadline = 0;
  addLog(`${p.name} called UNO`);
}

function catchUnoAction(playerId, targetId) {
  const catcher = state.players.find((p) => p.id === playerId);
  const target = state.players.find((p) => p.id === targetId);
  if (!catcher || !target || target.hand.length !== 1 || target.unoCalled) return;

  dealCards(target, 4);
  target.unoDeadline = 0;
  addLog(`${catcher.name} caught ${target.name} not saying UNO (+4)`);
}

function chooseColorAction(playerId, color) {
  if (!COLORS.includes(color)) return;
  if (state.players[state.currentPlayerIndex]?.id !== playerId) return;
  if (state.colorChoicePlayerId !== playerId) return;

  const actor = state.players.find((p) => p.id === playerId);
  const mode = state.colorChoiceMode;
  const cardValue = state.colorChoiceCardValue;

  state.currentColor = color;
  state.colorChoicePlayerId = null;
  state.colorChoiceMode = null;
  state.colorChoiceCardValue = null;
  addLog(`${findPlayerName(playerId)} chose ${color}`);

  if (mode === "roulette" && actor) {
    drawUntilColorMatch(actor, color);

    if (actor.hand.length === 1) {
      actor.unoCalled = false;
      actor.unoDeadline = Date.now() + UNO_GRACE_MS;
      addLog(`${actor.name} has one card!`);
    } else {
      actor.unoCalled = false;
      actor.unoDeadline = 0;
    }

    nextPlayer();
    resetTurnDeadline();
    return;
  }

  if (cardValue === "wildreverse4" || cardValue === "wild4") {
    state.direction *= -1;
    if (state.players.length === 2 && actor) {
      dealCards(actor, state.pendingDraw);
      addLog(`${actor.name} drew ${state.pendingDraw}`);
      state.pendingDraw = 0;
      state.pendingType = null;
      state.pendingMinDrawValue = 0;
      state.skipChain += 1;
    }
  }

  if (actor && actor.hand.length === 0) {
    finishRound(actor.id);
    return;
  }

  nextPlayer();
  while (state.skipChain > 0) {
    addLog(`${state.players[state.currentPlayerIndex].name} was skipped`);
    state.skipChain -= 1;
    nextPlayer();
  }

  resetTurnDeadline();
}

function swapHandsAction(playerId, targetId) {
  const source = state.players.find((p) => p.id === playerId);
  const target = state.players.find((p) => p.id === targetId);
  if (!source || !target || source.id === target.id) return;
  const hold = source.hand;
  source.hand = target.hand;
  target.hand = hold;
  addLog(`${source.name} swapped hands with ${target.name}`);
}

function applyCardImmediateEffect(card, playerId, initialFlip) {
  const drawValue = getDrawValue(card);
  if (drawValue > 0) {
    state.pendingDraw += drawValue;
    state.pendingMinDrawValue = Math.max(state.pendingMinDrawValue || 0, drawValue);
    state.pendingType = "draw";
  }

  if (card.value === "reverse" && !initialFlip) {
    state.direction *= -1;
  }

  if (card.value === "skip") {
    state.skipChain += 1;
  }

  if (card.value === "skipeveryone") {
    state.skipChain += Math.max(0, state.players.filter((p) => p.connected || p.ai).length - 1);
  }

  if (card.value === "0") {
    rotateHandsClockwise();
    addLog("Zero rotate activated (all hands rotated clockwise)");
  }

  if (card.value === "7") {
    const actor = state.players.find((p) => p.id === playerId);
    const targets = state.players.filter((p) => p.id !== playerId);
    if (targets.length > 0) {
      const pick = targets[Math.floor(Math.random() * targets.length)];
      swapHandsAction(playerId, pick.id);
      if (actor && actor.hand.length === 1) {
        actor.unoCalled = true;
      }
    }
  }

}

function advanceTurnAfterPlay(lastCard, playerId) {
  if (lastCard.value === "reverse" && state.players.length === 2) {
    state.skipChain += 1;
  }

  nextPlayer();

  while (state.skipChain > 0) {
    addLog(`${state.players[state.currentPlayerIndex].name} was skipped`);
    state.skipChain -= 1;
    nextPlayer();
  }

  if (isRouletteWild(lastCard)) {
    state.colorChoicePlayerId = state.players[state.currentPlayerIndex]?.id || null;
    state.colorChoiceMode = "roulette";
    state.colorChoiceCardValue = lastCard.value;
    if (state.colorChoicePlayerId) {
      addLog(`${state.players[state.currentPlayerIndex].name} must choose a color`);
    }
  }

  if (state.pendingDraw > 0) {
    const current = state.players[state.currentPlayerIndex];
    const stackable = current.hand.some((card) => getDrawValue(card) >= (state.pendingMinDrawValue || 0));

    if (!stackable && current.ai) {
      dealCards(current, state.pendingDraw);
      addLog(`${current.name} (AI) drew ${state.pendingDraw}`);
      state.pendingDraw = 0;
      state.pendingType = null;
      state.pendingMinDrawValue = 0;
      nextPlayer();
    }
  }

  const actor = state.players.find((p) => p.id === playerId);
  if (actor && actor.hand.length === 1 && !actor.unoCalled) {
    actor.unoDeadline = Date.now() + UNO_GRACE_MS;
  }

  resetTurnDeadline();
}

function nextPlayer() {
  const len = state.players.length;
  // Filter for players who are still in the game (connected/ai and have cards or it's a new round lobby)
  const activeCount = state.players.filter(p => (p.connected || p.ai) && (state.phase === "lobby" || p.hand.length > 0)).length;
  if (len === 0 || activeCount === 0) return;

  let idx = state.currentPlayerIndex;
  do {
    idx = (idx + state.direction + len) % len;
  } while (!(state.players[idx].connected || state.players[idx].ai) || (state.phase === "playing" && state.players[idx].hand.length === 0));
  state.currentPlayerIndex = idx;
}

function timeoutAdvance(reason) {
  const p = state.players[state.currentPlayerIndex];
  dealCards(p, 1);
  addLog(`${reason}: ${p.name} drew 1`);
  nextPlayer();
  resetTurnDeadline();
}

function rotateHandsClockwise() {
  const hands = state.players.map((p) => p.hand);
  const moved = hands.map((_, idx) => hands[(idx - 1 + hands.length) % hands.length]);
  state.players.forEach((p, idx) => {
    p.hand = moved[idx];
  });
}

function dealCards(player, count) {
  for (let i = 0; i < count; i += 1) {
    if (state.deck.length === 0) recycleDeck();
    if (state.deck.length === 0) break;
    player.hand.push(state.deck.pop());
  }

  if (player.hand.length >= 25) {
    player.hand = [];
    player.connected = false;
    player.ai = false;
    addLog(`${player.name} reached 25 cards and is out of the game!`);
    
    // Check if only one player remains
    const remaining = state.players.filter(p => (p.connected || p.ai) && p.hand.length > 0);
    if (remaining.length === 1) {
      finishRound(remaining[0].id);
    } else if (remaining.length === 0) {
      finishRound(null);
    }
  }
}

function recycleDeck() {
  if (state.discardPile.length <= 1) return;
  const top = state.discardPile.pop();
  const rest = state.discardPile;
  state.discardPile = [top];
  shuffle(rest);
  state.deck.push(...rest);
  addLog("Deck reshuffled from discard pile");
}

function finishRound(winnerId) {
  state.winnerId = winnerId;
  state.phase = "ended";
  const winner = state.players.find((p) => p.id === winnerId);
  if (winner) winner.score += calculateRoundPoints(winnerId);
  addLog(`${winner ? winner.name : "Player"} wins the round`);
}

function calculateRoundPoints(winnerId) {
  return state.players
    .filter((p) => p.id !== winnerId)
    .flatMap((p) => p.hand)
    .reduce((sum, card) => {
      if (/^\d$/.test(card.value)) return sum + Number(card.value);
      if (isWildCard(card) || card.value === "wildreverse4" || card.value === "wilddraw6" || card.value === "wilddraw10") {
        return sum + 50;
      }
      return sum + 20;
    }, 0);
}

function hostTick() {
  if (!isHost() || !state || state.phase !== "playing") return;
  const now = Date.now();
  let changed = false;

  state.players.forEach((p) => {
    if (p.connected || p.ai || !p.disconnectedAt) return;
    if (now - p.disconnectedAt > 60000) {
      p.ai = true;
      p.forfeits = (p.forfeits || 0) + 1;
      addLog(`${p.name} replaced by AI`);
      changed = true;
      if (p.forfeits >= 3) {
        p.connected = false;
        p.ai = false;
        p.hand = [];
        addLog(`${p.name} removed after 3 forfeits`);
        changed = true;
      }
    }
  });

  state.players.forEach((p) => {
    if (p.hand.length === 1 && !p.unoCalled && p.unoDeadline > 0 && now > p.unoDeadline) {
      dealCards(p, 4);
      p.unoDeadline = 0;
      addLog(`${p.name} failed UNO call (+4)`);
      changed = true;
    }
  });

  if (now > state.turnDeadline) {
    timeoutAdvance("Turn timeout");
    changed = true;
  }

  if (maybeRunAiTurn()) {
    changed = true;
  }

  if (changed) {
    publishState();
  }
}

function maybeRunAiTurn() {
  const current = state.players[state.currentPlayerIndex];
  if (!current || !current.ai) return false;

  if (state.colorChoicePlayerId === current.id) {
    chooseColorAction(current.id, COLORS[Math.floor(Math.random() * COLORS.length)]);
    return true;
  }

  const top = getTopCard();
  const playable = current.hand.filter((card) => canPlayCard(card, current, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue));

  if (playable.length > 0) {
    playCardsAction(current.id, [playable[0].id]);
    return true;
  }

  drawCardAction(current.id);
  return true;
}

function canPlayCard(card, player, top, currentColor, pendingDraw, pendingMinDrawValue) {
  if (!card || !top) return false;
  if (pendingDraw > 0) {
    const drawValue = getDrawValue(card);
    return drawValue >= (pendingMinDrawValue || 0);
  }

  const effectiveColor = isWildCard(top) ? currentColor : top.color;

  if (isWildCard(card)) return true;
  if (card.color === effectiveColor) return true;
  if (card.value === top.value) return true;

  return false;
}

function isExactMatchJumpIn(card, top) {
  if (!card || !top) return false;
  if (isWildCard(card) && isWildCard(top)) return card.value === top.value;
  return card.color === top.color && card.value === top.value;
}

function resetTurnDeadline() {
  state.turnDeadline = Date.now() + state.turnSeconds * 1000;
}

function publishState() {
  if (!socketOpen || !state) return;
  state.version = (state.version || 0) + 1;
  sendNetwork({
    type: "state-sync",
    roomCode: state.roomCode,
    state,
  });
  render();
}

function render() {
  const inRoom = !!state && !!state.phase;
  el.lobbyView.classList.toggle("active", !inRoom);
  el.gameView.classList.toggle("active", inRoom);

  if (!inRoom) {
    return;
  }

  if (!hostTicker && isHost()) {
    hostTicker = setInterval(hostTick, 250);
  }
  if (hostTicker && !isHost()) {
    clearInterval(hostTicker);
    hostTicker = null;
  }

  el.roomCodeLabel.textContent = state.roomCode;
  el.phaseLabel.textContent = state.phase.toUpperCase();
  el.drawCount.textContent = String(state.deck.length);
  el.pendingDrawLabel.textContent = `Pending Draw: ${state.pendingDraw}`;
  el.currentColorLabel.textContent = `Current: ${state.currentColor || "-"}`;

  const current = state.players[state.currentPlayerIndex];
  el.turnLabel.textContent = `Turn: ${current ? current.name : "-"}`;

  renderPlayerStrip();
  renderOpponents();
  renderDiscard();
  renderHand();
  renderChat();
  renderLog();

  const self = getSelf();
  const inTurn = current && self && current.id === self.id;
  const awaitingColorChoice = state.colorChoicePlayerId === (self && self.id);
  const hasPlayableCard = !!self && self.hand.some((card) => canPlayCard(card, self, getTopCard(), state.currentColor, state.pendingDraw, state.pendingMinDrawValue));

  el.readyBtn.disabled = state.phase !== "lobby";
  el.startBtn.disabled = !(isHost() && state.phase === "lobby" && state.players.filter((p) => p.ready || p.isHost).length >= 2);
  el.playBtn.hidden = false;
  el.playBtn.disabled = state.phase !== "playing" || !inTurn || awaitingColorChoice || (playMode === "multi" ? selectedCards.size === 0 : !hasPlayableCard);
  el.drawBtn.disabled = state.phase !== "playing" || !inTurn || awaitingColorChoice || (!state.pendingDraw && hasPlayableCard(self));
  el.unoBtn.disabled = !(self && self.hand.length === 1 && state.phase === "playing");

  const catchable = state.players.some(
    (p) => p.id !== playerProfile.id && p.hand.length === 1 && !p.unoCalled && p.unoDeadline > 0,
  );
  el.catchUnoBtn.disabled = !catchable || state.phase !== "playing";

  const t = Math.max(0, state.turnDeadline - Date.now());
  const pct = state.phase === "playing" ? (t / (state.turnSeconds * 1000)) * 100 : 100;
  el.turnTimerBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  if (!timerAnimFrame) {
    animateTimerBar();
  }

  syncColorChoiceDialog();

  syncPlayModeControls();
}

function renderPlayerStrip() {
  const current = state.players[state.currentPlayerIndex];
  el.playerStrip.innerHTML = state.players
    .map((p) => {
      const flags = [
        p.ready ? "Ready" : "Not Ready",
        p.connected ? "online" : "offline",
        p.ai ? "AI" : "human",
        p.unoCalled ? "UNO" : "",
      ]
        .filter(Boolean)
        .join(" • ");
      const readinessClass = p.ready ? "ready" : "not-ready";
      return `<article class="player-chip ${readinessClass} ${current && current.id === p.id ? "active" : ""}">
        <strong>${escapeHtml(p.name)}</strong>
        <div>Cards: ${p.hand.length}</div>
        <small>${flags}</small>
      </article>`;
    })
    .join("");
}

function renderOpponents() {
  const self = getSelf();
  if (!self) return;
  const others = state.players.filter((p) => p.id !== self.id);
  const half = Math.ceil(others.length / 2);
  const current = state.players[state.currentPlayerIndex];

  el.leftOpponents.innerHTML = others
    .slice(0, half)
    .map(
      (p) => `<article class="opp-card ${current && current.id === p.id ? "active" : ""}">
      <strong>${escapeHtml(p.name)}</strong>
      <div>${p.hand.length} cards</div>
      <small>${p.unoCalled ? "UNO!" : ""}</small>
    </article>`,
    )
    .join("");

  el.rightOpponents.innerHTML = others
    .slice(half)
    .map(
      (p) => `<article class="opp-card ${current && current.id === p.id ? "active" : ""}">
      <strong>${escapeHtml(p.name)}</strong>
      <div>${p.hand.length} cards</div>
      <small>${p.unoCalled ? "UNO!" : ""}</small>
    </article>`,
    )
    .join("");
}

function renderDiscard() {
  const top = getTopCard();
  if (!top) {
    el.drawPile.nextElementSibling.classList.remove("plop-anim");
    el.discardCard.innerHTML = "";
    return;
  }
  el.discardCard.innerHTML = cardElement(top, false);
  
  // Re-trigger animation
  const pile = el.drawPile.nextElementSibling; // the discard pile
  pile.classList.remove("plop-anim");
  void pile.offsetWidth; // trigger reflow
  pile.classList.add("plop-anim");
}

function renderHand() {
  const self = getSelf();
  if (!self) return;

  if (playMode !== "multi" && selectedCards.size > 0) {
    selectedCards.clear();
  }

  const handIds = new Set(self.hand.map((c) => c.id));
  selectedCards.forEach((id) => {
    if (!handIds.has(id)) selectedCards.delete(id);
  });

  const top = getTopCard();
  const inTurn = state.players[state.currentPlayerIndex]?.id === self.id;
  const awaitingColorChoice = state.colorChoicePlayerId === self.id;
  const turnActive = inTurn && !awaitingColorChoice;

  el.handArea.classList.toggle("turn-active", turnActive);

  el.handArea.innerHTML = self.hand
    .map((card, index) => {
      const playable = turnActive && canPlayCard(card, self, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue);
      const selected = playMode === "multi" && selectedCards.has(card.id);
      const delay = Math.min(index * 14, 170);
      return `<button class="uno-card card-${card.color} ${playable ? "playable" : "disabled"} ${selected ? "selected" : ""}" ${playable ? "" : "disabled"} data-card-id="${card.id}" style="--entry-delay:${delay}ms">
        ${cardContent(card)}
      </button>`;
    })
    .join("");

  el.handArea.querySelectorAll("[data-card-id]").forEach((node) => {
    node.addEventListener("click", (event) => {
      const id = node.getAttribute("data-card-id");
      if (!id) return;
      const card = self.hand.find((c) => c.id === id);
      if (!card) return;
      const playable = turnActive && canPlayCard(card, self, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue);

      if (!playable) return;

      if (playMode === "single") {
        selectedCards.clear();
        sendAction({ type: "play-cards", cardIds: [id] });
        return;
      }

      if (selectedCards.has(id)) selectedCards.delete(id);
      else selectedCards.add(id);
      renderHand();
    });
  });
}

function animateTimerBar() {
  const tick = () => {
    if (state && state.phase === "playing") {
      const t = Math.max(0, state.turnDeadline - Date.now());
      const pct = (t / (state.turnSeconds * 1000)) * 100;
      el.turnTimerBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    }
    timerAnimFrame = requestAnimationFrame(tick);
  };
  timerAnimFrame = requestAnimationFrame(tick);
}

function renderChat() {
  el.chatList.innerHTML = state.chat
    .slice(-40)
    .map((m) => `<article class="chat-msg"><strong>${escapeHtml(m.name)}:</strong> ${escapeHtml(m.text)}</article>`)
    .join("");
  el.chatList.scrollTop = el.chatList.scrollHeight;
}

function renderLog() {
  el.logList.innerHTML = state.logs
    .slice(-60)
    .map((line) => `<article class="log-item">${escapeHtml(line.text)}</article>`)
    .join("");
  el.logList.scrollTop = el.logList.scrollHeight;
}

function showWinner() {
  const winner = state.players.find((p) => p.id === state.winnerId);
  el.winnerTitle.textContent = winner ? `${winner.name} Wins` : "Round Over";
  el.winnerSubtitle.textContent = winner ? `Score: ${winner.score}` : "";
  if (!el.winnerDialog.open) el.winnerDialog.showModal();
}

function leaveRoom() {
  if (socketOpen && state) {
    sendNetwork({ type: "leave-room", roomCode: state.roomCode, playerId: playerProfile.id });
  }
  state = null;
  selectedCards.clear();
  if (el.colorChoiceDialog?.open) {
    el.colorChoiceDialog.close();
  }
  if (hostTicker) {
    clearInterval(hostTicker);
    hostTicker = null;
  }
  render();
}

function getSelf() {
  if (!state) return null;
  return state.players.find((p) => p.id === playerProfile.id) || null;
}

function getTopCard() {
  if (!state || state.discardPile.length === 0) return null;
  return state.discardPile[state.discardPile.length - 1];
}

function isWildCard(card) {
  return !!card && card.color === "wild";
}

function isRouletteWild(card) {
  return !!card && card.value === "wild";
}

function isSetupIgnoredCard(card) {
  if (!card) return false;
  return ["skip", "reverse", "draw2", "draw4", "draw6", "draw10", "discardall", "skipeveryone", "wild", "wildreverse4", "wilddraw6", "wilddraw10", "wild4"].includes(card.value);
}

function getDrawValue(card) {
  if (!card) return 0;
  return DRAW_VALUES.get(card.value) || 0;
}

function hasPlayableCard(player) {
  const top = getTopCard();
  return player.hand.some((card) => canPlayCard(card, player, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue));
}

function drawUntilPlayableAndPlay(player) {
  const top = getTopCard();
  let drawn = 0;

  while (true) {
    if (state.deck.length === 0) recycleDeck();
    if (state.deck.length === 0) return false;

    const card = state.deck.pop();
    player.hand.push(card);
    drawn += 1;

    if (canPlayCard(card, player, top, state.currentColor, state.pendingDraw, state.pendingMinDrawValue)) {
      if (drawn > 0) addLog(`${player.name} drew ${drawn} card${drawn === 1 ? "" : "s"}`);
      playCardsAction(player.id, [card.id]);
      return true;
    }
  }
}

function drawUntilColorMatch(player, color) {
  let drawn = 0;
  let matched = false;

  while (true) {
    if (state.deck.length === 0) recycleDeck();
    if (state.deck.length === 0) break;

    const card = state.deck.pop();
    player.hand.push(card);
    drawn += 1;

    if (card.color === color) {
      matched = true;
      break;
    }
  }

  if (drawn > 0) {
    addLog(`${player.name} drew ${drawn} card${drawn === 1 ? "" : "s"}${matched ? ` and hit ${color}` : ` looking for ${color}`}`);
  }
}

function syncColorChoiceDialog() {
  if (!el.colorChoiceDialog) return;

  const shouldOpen = !!state && state.phase === "playing" && state.colorChoicePlayerId === playerProfile.id;
  if (shouldOpen && !el.colorChoiceDialog.open) {
    el.colorChoiceDialog.showModal();
  } else if (!shouldOpen && el.colorChoiceDialog.open) {
    el.colorChoiceDialog.close();
  }
}

function isAwaitingColorChoiceForSelf() {
  return !!state && state.colorChoicePlayerId === playerProfile.id;
}

function addLog(text) {
  state.logs.push(logLine("Game", text));
  state.logs = state.logs.slice(-120);
}

function logLine(type, text) {
  return {
    id: crypto.randomUUID(),
    type,
    text,
    ts: Date.now(),
  };
}

function makePlayer(id, name, isHost) {
  return {
    id,
    name,
    isHost,
    connected: true,
    ready: isHost,
    ai: false,
    hand: [],
    score: 0,
    unoCalled: false,
    unoDeadline: 0,
    forfeits: 0,
    disconnectedAt: null,
  };
}

function buildDeck() {
  const deck = [];

  COLORS.forEach((color) => {
    deck.push(makeCard(color, "0"));
    for (let v = 1; v <= 9; v += 1) {
      deck.push(makeCard(color, String(v)));
      deck.push(makeCard(color, String(v)));
    }

    ["skip", "reverse", "draw2", "discardall", "skipeveryone"].forEach((value) => {
      deck.push(makeCard(color, value));
      deck.push(makeCard(color, value));
    });
  });

  for (let i = 0; i < 7; i += 1) {
    deck.push(makeCard("wild", "wild"));
  }

  for (let i = 0; i < 7; i += 1) {
    deck.push(makeCard("wild", "draw4"));
  }

  for (let i = 0; i < 7; i += 1) {
    deck.push(makeCard("wild", "wildreverse4"));
  }

  for (let i = 0; i < 7; i += 1) {
    deck.push(makeCard("wild", "wilddraw6"));
  }

  for (let i = 0; i < 7; i += 1) {
    deck.push(makeCard("wild", "wilddraw10"));
  }

  return deck;
}

function makeCard(color, value) {
  return {
    id: crypto.randomUUID(),
    color,
    value,
  };
}

function cardFace(card) {
  return VALUE_LABELS[card.value] || card.value;
}

function cardShort(card) {
  return `[${card.color}:${cardFace(card)}]`;
}

function cardContent(card) {
  if (card.value === "discardall") {
    return `<div class="card-face-special card-face-discardall">
      <span class="corner tl">DA</span>
      <span class="center">ALL</span>
      <span class="corner br">DA</span>
    </div>`;
  }
  if (card.value === "skip") {
    return `<img src="${getSpecialCardAsset(card)}" class="card-asset" draggable="false" alt="Skip" />`;
  }
  if (card.value === "reverse") {
    return `<img src="${getSpecialCardAsset(card)}" class="card-asset" draggable="false" alt="Reverse" />`;
  }
  if (card.value === "draw2") {
    return `<img src="${getSpecialCardAsset(card)}" class="card-asset" draggable="false" alt="Draw 2" />`;
  }
  if (card.value === "wild") {
    return `<img src="${getSpecialCardAsset(card)}" class="card-asset" draggable="false" alt="Wild Color Roulette" />`;
  }
  if (card.value === "wild4" || card.value === "draw4") {
    return `<img src="${getSpecialCardAsset(card)}" class="card-asset" draggable="false" alt="Wild Draw 4" />`;
  }
  if (card.value === "draw6" || card.value === "draw10" || card.value === "wildreverse4" || card.value === "wilddraw6" || card.value === "wilddraw10") {
    return `<div class="card-face-special">
      <span class="corner tl">${cardFace(card)}</span>
      <span class="center">${cardFace(card)}</span>
      <span class="corner br">${cardFace(card)}</span>
    </div>`;
  }
  return `<div class="card-face-number">
    <span class="corner tl">${cardFace(card)}</span>
    <span class="center">${cardFace(card)}</span>
    <span class="corner br">${cardFace(card)}</span>
  </div>`;
}

function cardElement(card, includeButton) {
  let tone;
  if (COLORS.includes(card.color)) tone = card.color;
  else if (card.color === "wild" && state?.currentColor) tone = state.currentColor;
  else if (card.value.startsWith("wild")) tone = "wild";
  else tone = state?.currentColor || "wild";

  const content = includeButton
    ? `<div class="uno-card card-${tone}">${cardContent(card)}</div>`
    : `<div class="uno-card card-${tone} discard-card">${cardContent(card)}</div>`;
  if (includeButton) return `<button>${content}</button>`;
  return content;
}

function sanitizeRoomCodeChar(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 1);
}

function getSpecialCardAsset(card) {
  if (card.value === "wild") return "assets/special/wild.svg";
  if (card.value === "wild4" || card.value === "draw4") return "assets/special/wild4.svg";

  const color = COLORS.includes(card.color) ? card.color : "red";
  const map = {
    skip: `assets/special/${color}_skip.svg`,
    reverse: `assets/special/${color}_reverse.svg`,
    draw2: `assets/special/${color}_draw2.svg`,
  };

  return map[card.value] || "assets/reverse.svg";
}

function findPlayerName(id) {
  const p = state.players.find((x) => x.id === id);
  return p ? p.name : "Unknown";
}

function isHost() {
  return !!state && state.hostId === playerProfile.id;
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function sanitizeName(name) {
  const clean = (name || "Player").replace(/\s+/g, " ").trim();
  return clean.slice(0, 20) || "Player";
}

function setLobbyStatus(text) {
  el.lobbyStatus.textContent = text;
}

function setNetworkStatus(text) {
  el.networkStatus.textContent = `Network: ${text}`;
}

function setPlayMode(nextMode) {
  if (nextMode !== "single" && nextMode !== "multi") return;
  if (playMode === nextMode) return;
  playMode = nextMode;
  localStorage.setItem(STORAGE_PLAY_MODE_KEY, playMode);
  if (playMode !== "multi") selectedCards.clear();
  render();
}

function syncPlayModeControls() {
  const isSingle = playMode === "single";
  if (el.clickPlayModeBtn) {
    el.clickPlayModeBtn.classList.toggle("active", isSingle);
    el.clickPlayModeBtn.setAttribute("aria-pressed", String(isSingle));
  }
  if (el.multiSelectModeBtn) {
    el.multiSelectModeBtn.classList.toggle("active", !isSingle);
    el.multiSelectModeBtn.setAttribute("aria-pressed", String(!isSingle));
  }
  if (el.playBtn) {
    el.playBtn.textContent = isSingle ? "Play Card" : "Play Selected";
  }
}

function loadProfile() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.id && parsed.name) return parsed;
    } catch {
      // Ignore corrupted local profile.
    }
  }
  const profile = {
    id: crypto.randomUUID(),
    name: `Player-${Math.floor(Math.random() * 900 + 100)}`,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  return profile;
}

function saveProfile() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playerProfile));
}

function loadServerUrl() {
  const queryServer = getServerUrlFromLocation();
  if (queryServer) return queryServer;

  const stored = localStorage.getItem(STORAGE_SERVER_KEY);
  if (stored && sanitizeServerUrl(stored)) return stored;
  // Prefer the explicit project default backend (Render host) when available.
  if (DEFAULT_SERVER_URL) return DEFAULT_SERVER_URL;
  // Otherwise, use same-host (useful for local dev when served over http/s).
  if (location.protocol === "http:" || location.protocol === "https:") {
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${location.host}`;
  }
  // Fallback to localhost WebSocket.
  return "ws://localhost:8080";
}

function getServerUrlFromLocation() {
  try {
    const url = new URL(window.location.href);
    const candidate = url.searchParams.get("server") || url.searchParams.get("ws");
    return sanitizeServerUrl(candidate);
  } catch {
    return null;
  }
}

function loadPlayMode() {
  return localStorage.getItem(STORAGE_PLAY_MODE_KEY) === "multi" ? "multi" : "single";
}

function saveServerUrl(url) {
  localStorage.setItem(STORAGE_SERVER_KEY, url);
}

function sanitizeServerUrl(input) {
  const value = String(input || "").trim();
  if (!value) return null;
  if (value.startsWith("ws://") || value.startsWith("wss://")) return value;
  return null;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

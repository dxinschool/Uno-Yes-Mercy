# Uno No Mercy - Premium Multiplayer Game

## Concept & Vision

A high-stakes multiplayer Uno experience that channels the tension of late-night game sessions. The "No Mercy" variant amplifies every moment with stacking penalties, dramatic hand swaps, and ruthless mechanics. The design evokes a neon-lit underground gaming den — dark, sleek, with bursts of vibrant card colors that pop against the darkness.

## Design Language

### Aesthetic Direction
Dark luxury gaming aesthetic — think premium poker room meets arcade. Deep blacks with neon accent glows, glass-morphism panels, and satisfying card animations.

### Color Palette
- **Primary Background**: `#0a0a0f` (deep void black)
- **Secondary Background**: `#151520` (elevated panels)
- **Card Red**: `#ff3b5c` (hot coral)
- **Card Blue**: `#3b82ff` (electric blue)
- **Card Green**: `#22c55e` (neon green)
- **Card Yellow**: `#fbbf24` (amber gold)
- **Wild/Special**: `#a855f7` (electric purple)
- **Accent Glow**: `#00d4ff` (cyan neon)
- **Text Primary**: `#ffffff`
- **Text Secondary**: `#6b7280`
- **Danger/Warning**: `#ef4444`
- **Success**: `#10b981`

### Typography
- **Headings**: `Orbitron` — futuristic, bold, perfect for gaming
- **Body/UI**: `Exo 2` — clean, modern, readable
- **Card Numbers**: `Russo One` — impactful, clear
- Fallback: `system-ui, sans-serif`

### Spatial System
- Base unit: 8px
- Card size: 80px × 120px (desktop), scales down mobile
- Generous padding in game area, tight in HUD elements
- Glass-morphism: `backdrop-filter: blur(20px)`, `background: rgba(255,255,255,0.05)`

### Motion Philosophy
- Card plays: spring physics (overshoot 1.2, settle)
- Card draw: arc trajectory animation
- Turn indicator: pulse glow animation
- Chat messages: slide-in from bottom
-uno call: shake + scale burst
- Win/Lose: confetti burst + modal fade

### Visual Assets
- Lucide icons for UI elements
- Custom SVG card designs with gradient fills
- Animated gradient background with subtle particle effect
- Glow effects on active elements

## Layout & Structure

### Main Sections
1. **Landing/Lobby** — Room creation, join, player list
2. **Game Room** — Main gameplay area
3. **Results Screen** — Scoreboard, winner celebration

### Game Room Layout
```
┌─────────────────────────────────────────────────┐
│  HEADER: Room code, players online, settings    │
├─────────────────────────────────────────────────┤
│  ┌─────┐                         ┌─────┐        │
│  │ OPP │    DISCARD PILE         │ OPP │        │
│  │  2  │    [Current Card]       │  1  │        │
│  │     │    + Draw pile          │     │        │
│  └─────┘                         └─────┘        │
├─────────────────────────────────────────────────┤
│           YOUR HAND (scrollable)                │
│    [Card] [Card] [Card] [Card] [Card] ...       │
├─────────────────────────────────────────────────┤
│  CHAT PANEL (collapsible)     │  GAME LOG       │
│  Messages + input             │  Recent actions │
└─────────────────────────────────────────────────┘
```

### Responsive Strategy
- Desktop: Full layout with side panels
- Tablet: Stacked layout, collapsible chat
- Mobile: Compact cards, bottom sheet for chat, swipe navigation

## Features & Interactions

### Lobby System
- Create room (generates 4-6 char code)
- Join room with code
- Max 10 players per room
- Player ready toggle
- Host can start when 2+ players ready
- Spectator mode for full rooms

### Uno Call Mechanics
- Must call "UNO!" when down to 1 card
- Auto-detect and prompt if player forgets
- 2-second grace period
- Penalty: draw 4 cards if caught
- Button appears when 2 cards left

### Uno No Mercy Specific Rules
1. **Stackable Draw 2**: Players can stack Draw 2 cards indefinitely
2. **Stackable Wild Draw 4**: Can stack, challenger must prove invalid
3. **Same Value Play**: Can play multiple cards of same value/rank
4. **Seven Swap**: 7 played → swap hands with any player
5. **Zero Swap**: 0 played → all hands rotate clockwise
6. **Jump-In Extreme**: Can play on exact match anytime
7. **7-0 Challenge**: Swap challenge if 7 played with no valid

### Card Interactions
- Hover: lift + glow effect
- Click valid: play animation → move to discard
- Click invalid: shake + red flash
- Right-click: quick info tooltip

### Turn System
- Clear visual indicator (glowing border)
- Timer bar (configurable 15-60s)
- Skip button for host if AFK detected
- Auto-skip on timeout with penalty draw

### Chat System
- Real-time messaging
- System messages for game events
- Emoji support
- Player mentions
- Auto-scroll with new message indicator

### Game End Conditions
- First to 500 points wins (classic)
- Or: last player standing (elimination mode)
- Points: Card values (0-9 face, 20 for Draw, 50 for Wild)

### Forfeit/Disconnect Handling
- 60s reconnect window
- AI takes over if player disconnects
- 3 consecutive forfeits = removed from game
- Remaining players continue
- Win by forfeit counts

### Error States
- Invalid card play: shake animation + tooltip
- Not your turn: card locked + message
- Empty deck: reshuffle discard (except top)

## Component Inventory

### Card Component
- States: default, hover, selected, disabled, playing, drawing
- 108 cards: 4 colors × (1×0, 2×1-9, 2×Skip, 2×Reverse, 2×Draw 2)
- 4 Wilds × 4 colors
- 8 Wild Draw 4
- Visual: rounded corners, gradient fill, glow on hover

### Player Avatar
- States: waiting, playing, card-count indicator, winner, forfeited
- Shows: avatar, username, card count badge, UNO indicator
- Glowing border for active turn

### Action Buttons
- UNO button (pulsing when available)
- Draw card (when can't play)
- Chat send
- Ready/Start/Leave

### Chat Message
- Types: player, system, event
- Timestamp
- Player color indicator

### Game Log Entry
- Icon + description + timestamp
- Color-coded by event type

### Modal Dialogs
- Forfeit confirmation
- Winner announcement
- Challenge result
- Settings panel

## Technical Approach

### Stack
- Single HTML file with embedded CSS/JS
- WebSocket simulation with BroadcastChannel (same-device multiplayer)
- LocalStorage for persistence
- No external dependencies except Google Fonts + Lucide CDN

### Architecture
- State machine for game phases: `lobby` → `playing` → `ended`
- Event-driven card system
- Modular functions for each rule
- Central game state object

### Key Data Structures
```javascript
gameState = {
  phase: 'lobby' | 'playing' | 'ended',
  roomCode: string,
  players: [{id, name, hand[], isHost, connected, score}],
  currentPlayerIndex: number,
  deck: Card[],
  discardPile: Card[],
  direction: 1 | -1,
  pendingDraw: number,
  lastPlayedBy: playerId,
  winner: playerId | null
}
```

### Multiplayer Sync
- Host is authoritative
- All actions broadcast to room
- State reconciliation on reconnect
- Latency compensation for animations

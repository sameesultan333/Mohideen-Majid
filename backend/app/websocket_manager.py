from fastapi import WebSocket, WebSocketDisconnect


class ConnectionManager:
    def __init__(self):
        self.channels = {
            "announcements": [],
            "prayer": [],
            "questions": [],
            "hadith": []
        }

    # ─────────────────────────────────────────────
    # CONNECT
    # ─────────────────────────────────────────────
    async def connect(self, websocket: WebSocket, channel: str):
        await websocket.accept()

        if channel not in self.channels:
            self.channels[channel] = []

        self.channels[channel].append(websocket)

        print(f"✅ {channel.upper()} CONNECTED:", len(self.channels[channel]))

    # ─────────────────────────────────────────────
    # DISCONNECT (SAFE)
    # ─────────────────────────────────────────────
    def disconnect(self, websocket: WebSocket, channel: str):
        if channel in self.channels and websocket in self.channels[channel]:
            self.channels[channel].remove(websocket)

        if len(self.channels.get(channel, [])) > 0:
         print(f"❌ {channel.upper()} DISCONNECTED:", len(self.channels[channel]))

    # ─────────────────────────────────────────────
    # BROADCAST (SAFE CLEANUP)
    # ─────────────────────────────────────────────
    async def broadcast(self, channel: str, message: dict):
        if channel not in self.channels:
            return

        dead_connections = []

        for connection in self.channels[channel]:
            try:
                await connection.send_json(message)
            except:
                dead_connections.append(connection)

        # 🔥 CLEAN DEAD SOCKETS
        for dead in dead_connections:
            self.channels[channel].remove(dead)

        print(f"📡 BROADCAST → {channel.upper()} ({len(self.channels[channel])} active)")


manager = ConnectionManager()
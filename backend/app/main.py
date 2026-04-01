from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from app.routes import admin
from app.security import hash_password
from app.database import engine
from app import models
from app.routes import (
    auth,
    prayer,
    announcement,
    hadith,
    questions,
    donations,
    user,
    upload  
)
from app.websocket_manager import manager

# -----------------------------
# DB INIT
# -----------------------------
models.Base.metadata.create_all(bind=engine)

# -----------------------------
# APP INIT
# -----------------------------
app = FastAPI(
    title="Masjid API",
    version="2.0.0",
)

# -----------------------------
# CORS
# -----------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# ROUTES
# -----------------------------
app.include_router(auth.router)
app.include_router(prayer.router)
app.include_router(announcement.router)
app.include_router(hadith.router)
app.include_router(questions.router)
app.include_router(donations.router)
app.include_router(user.router)
app.include_router(upload.router)  # ✅ IMPORTANT
app.include_router(admin.router)
# -----------------------------
# STATIC FILES (UPLOADS)
# -----------------------------
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# -----------------------------
# BASIC ROUTES
# -----------------------------
@app.get("/")
def root():
    return {"message": "Masjid API running 🕌"}

@app.get("/health")
def health():
    return {"status": "OK"}

@app.get("/admin", response_class=HTMLResponse)
def admin_page():
    with open("app/templates/admin.html", encoding="utf-8") as f:
        return f.read()


# -----------------------------
# WEBSOCKETS
# -----------------------------
@app.websocket("/ws/announcements")
async def announcements_ws(websocket: WebSocket):
    await manager.connect(websocket, "announcements")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "announcements")


@app.websocket("/ws/prayer")
async def prayer_ws(websocket: WebSocket):
    await manager.connect(websocket, "prayer")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "prayer")


@app.websocket("/ws/questions")
async def questions_ws(websocket: WebSocket):
    await manager.connect(websocket, "questions")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "questions")


@app.websocket("/ws/hadith")
async def hadith_ws(websocket: WebSocket):
    await manager.connect(websocket, "hadith")
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, "hadith")
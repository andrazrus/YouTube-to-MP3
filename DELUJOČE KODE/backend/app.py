import os, glob, uuid, secrets, tempfile, subprocess, stat, shutil
from datetime import datetime, timedelta
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, UniqueConstraint
from sqlalchemy.orm import sessionmaker, declarative_base
from passlib.context import CryptContext
from cryptography.fernet import Fernet  # used ONLY for temp passwords

# -------------------- App & CORS --------------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

@app.get("/", response_class=HTMLResponse)
def root():
    return "<p>FastAPI running. Frontend on http://127.0.0.1:5173</p>"

# -------------------- DB --------------------
DATABASE_URL = "sqlite:///./videos.db"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class Video(Base):
    __tablename__ = "videos"
    id = Column(String, primary_key=True, index=True)
    url = Column(String)
    status = Column(String)
    filename = Column(String)
    owner_username = Column(String, index=True, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, index=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)  # current login secret (hashed)
    enc_password = Column(String, nullable=True)    # legacy column – not exposed
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    # NEW: temp password controls
    temp_password_enc = Column(String, nullable=True)
    temp_expires_at = Column(DateTime, nullable=True)
    temp_shown_once = Column(Boolean, default=False)
    __table_args__ = (UniqueConstraint("username", name="uq_users_username"),)

Base.metadata.create_all(bind=engine)

# --- tiny auto-migrations for SQLite ---
with engine.connect() as conn:
    cols_users = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
    def addcol(name, ddl):
        if name not in cols_users:
            conn.exec_driver_sql(f"ALTER TABLE users ADD COLUMN {ddl};")
    addcol("enc_password", "enc_password TEXT")
    addcol("temp_password_enc", "temp_password_enc TEXT")
    addcol("temp_expires_at", "temp_expires_at TEXT")
    addcol("temp_shown_once", "temp_shown_once INTEGER DEFAULT 0")

    cols_vid = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(videos)").fetchall()]
    if "owner_username" not in cols_vid:
        conn.exec_driver_sql("ALTER TABLE videos ADD COLUMN owner_username TEXT;")

# -------------------- Crypto helpers (for temp passwords only) --------------------
KEY_PATH = os.environ.get("FERNET_KEY_PATH", "secret.key")

def _load_or_create_key() -> bytes:
    if os.path.exists(KEY_PATH):
        with open(KEY_PATH, "rb") as f:
            return f.read().strip()
    key = Fernet.generate_key()
    with open(KEY_PATH, "wb") as f:
        f.write(key)
    try:
        os.chmod(KEY_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        pass
    return key

FERNET = Fernet(_load_or_create_key())

def f_encrypt(text: str) -> str:
    return FERNET.encrypt(text.encode("utf-8")).decode("utf-8")

def f_decrypt(token: str) -> str:
    return FERNET.decrypt(token.encode("utf-8")).decode("utf-8")

# -------------------- Auth --------------------
VALID_TOKENS: Dict[str, str] = {}  # token -> username
pwd_ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str

class ResetPasswordBody(BaseModel):
    new_password: Optional[str] = None
    generate: Optional[bool] = False
    ttl_minutes: Optional[int] = 60  # for temp pw, default 60m

class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str

def _get_user_by_token(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    username = VALID_TOKENS.get(token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user
    finally:
        db.close()

# -------------------- Temp dir for MP3s --------------------
TMP_DIR = os.environ.get("TMP_DIR", tempfile.gettempdir())
os.makedirs(TMP_DIR, exist_ok=True)

# -------------------- User endpoints --------------------
@app.post("/register")
def register(data: RegisterRequest):
    db = SessionLocal()
    try:
        if db.query(User).filter(User.username == data.username).first():
            raise HTTPException(status_code=409, detail="Username already exists")
        is_first = db.query(User).count() == 0
        user = User(
            username=data.username,
            password_hash=pwd_ctx.hash(data.password),
            enc_password=f_encrypt(data.password),  # legacy copy; never exposed
            is_admin=is_first,
        )
        db.add(user)
        db.commit()
        return {"id": user.id, "username": user.username, "is_admin": user.is_admin}
    finally:
        db.close()

@app.post("/login")
def login(data: LoginRequest):
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == data.username).first()
        if user and pwd_ctx.verify(data.password, user.password_hash):
            token = secrets.token_urlsafe(32)
            VALID_TOKENS[token] = user.username
            return {"token": token, "user": user.username, "is_admin": bool(user.is_admin)}
        raise HTTPException(status_code=401, detail="Invalid credentials")
    finally:
        db.close()

@app.get("/me")
def me(authorization: str = Header(None)):
    u = _get_user_by_token(authorization)
    return {"user": u.username, "is_admin": bool(u.is_admin)}

@app.get("/users")
def list_users(authorization: str = Header(None)):
    _ = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        rows = db.query(User).all()
        out = []
        now = datetime.utcnow()
        for u in rows:
            has_temp = bool(u.temp_password_enc and u.temp_expires_at and now < u.temp_expires_at)
            out.append({"username": u.username, "is_admin": bool(u.is_admin), "has_temp": has_temp})
        return out
    finally:
        db.close()

# ---------- Admin: set & show TEMP password ----------
@app.post("/users/{username}/temp_password")
def admin_set_temp_password(username: str, body: ResetPasswordBody, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    if not current.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        # generate or accept provided
        temp_pw = body.new_password if (body.new_password and not body.generate) else secrets.token_urlsafe(10)
        ttl = max(1, int(body.ttl_minutes or 60))
        user.password_hash = pwd_ctx.hash(temp_pw)  # temp becomes active login secret
        user.temp_password_enc = f_encrypt(temp_pw)
        user.temp_expires_at = datetime.utcnow() + timedelta(minutes=ttl)
        user.temp_shown_once = False
        db.commit()
        # Return it to the admin immediately
        return {
            "username": user.username,
            "temp_password": temp_pw,
            "expires_at": user.temp_expires_at.isoformat()
        }
    finally:
        db.close()

@app.get("/users/{username}/temp_password")
def admin_show_temp_password(username: str, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    if not current.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user or not user.temp_password_enc or not user.temp_expires_at:
            raise HTTPException(status_code=404, detail="No active temp password")
        if datetime.utcnow() > user.temp_expires_at:
            raise HTTPException(status_code=410, detail="Temp password expired")
        # optional one-time view: enable if you want to enforce
        # if user.temp_shown_once:
        #     raise HTTPException(status_code=403, detail="Temp password already viewed")
        temp_pw = f_decrypt(user.temp_password_enc)
        user.temp_shown_once = True
        db.commit()
        return {
            "username": user.username,
            "temp_password": temp_pw,
            "expires_at": user.temp_expires_at.isoformat()
        }
    finally:
        db.close()

@app.post("/change_password")
def change_password(body: ChangePasswordBody, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == current.username).first()
        if not u or not pwd_ctx.verify(body.current_password, u.password_hash):
            raise HTTPException(status_code=400, detail="Current password incorrect")
        u.password_hash = pwd_ctx.hash(body.new_password)
        u.enc_password = f_encrypt(body.new_password)  # legacy; never exposed
        # clear any temp password once user sets a real one
        u.temp_password_enc = None
        u.temp_expires_at = None
        u.temp_shown_once = False
        db.commit()
        return {"ok": True}
    finally:
        db.close()

# -------------------- Video endpoints (unchanged) --------------------
class VideoRequest(BaseModel):
    url: str

@app.post("/download")
def download_video(data: VideoRequest, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    db = SessionLocal()
    video_id = str(uuid.uuid4())
    video = Video(id=video_id, url=data.url, status="processing", owner_username=current.username)
    db.add(video)
    db.commit()
    try:
        ffmpeg_loc = os.getenv("FFMPEG_LOCATION")
        args = [
            "yt-dlp", "-x", "--audio-format", "mp3",
            "-o", f"{TMP_DIR}/{video_id}-%(title).200s.%(ext)s", data.url
        ]
        if ffmpeg_loc:
            args.extend(["--ffmpeg-location", ffmpeg_loc])
        if not ffmpeg_loc and not shutil.which("ffmpeg"):
            raise HTTPException(status_code=500, detail="ffmpeg not found. Install ffmpeg or set FFMPEG_LOCATION.")
        subprocess.run(args, check=True)

        matches = glob.glob(f"{TMP_DIR}/{video_id}-*.mp3")
        if not matches:
            video.status = "error"; db.commit()
            raise HTTPException(status_code=500, detail="MP3 not found")
        original_path = matches[0]
        original_filename = os.path.basename(original_path)
        trimmed_filename = original_filename[len(video_id) + 1:]
        new_path = os.path.join(TMP_DIR, trimmed_filename)
        os.rename(original_path, new_path)
        video.status = "ready"; video.filename = trimmed_filename; db.commit()
        return {"file_id": video_id, "filename": trimmed_filename}
    except subprocess.CalledProcessError:
        video.status = "error"; db.commit()
        raise HTTPException(status_code=500, detail="Download failed")
    finally:
        db.close()

@app.get("/status/{file_id}")
def check_status(file_id: str, authorization: str = Header(None)):
    _ = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == file_id).first()
        if not video or not video.filename:
            return {"ready": False}
        return {"ready": os.path.exists(os.path.join(TMP_DIR, video.filename))}
    finally:
        db.close()

@app.get("/download/{file_id}")
def get_file(file_id: str, authorization: str = Header(None)):
    _ = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == file_id).first()
        if not video or not video.filename:
            raise HTTPException(status_code=404, detail="File not found")
        path = os.path.join(TMP_DIR, video.filename)
        if not os.path.exists(path):
            raise HTTPException(status_code=404, detail="File not found")
        return FileResponse(path, media_type="audio/mpeg", filename=video.filename)
    finally:
        db.close()

@app.delete("/delete/{file_id}")
def delete_file(file_id: str, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        video = db.query(Video).filter(Video.id == file_id).first()
        if not video:
            raise HTTPException(status_code=404, detail="Video not found")
        if (video.owner_username or "") != current.username and not current.is_admin:
            raise HTTPException(status_code=403, detail="Not allowed")
        path = os.path.join(TMP_DIR, video.filename) if video.filename else None
        if path and os.path.exists(path):
            os.remove(path)
        db.delete(video); db.commit()
        return {"message": "Deleted"}
    finally:
        db.close()

@app.get("/videos")
def list_videos(authorization: str = Header(None)):
    _ = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        videos = db.query(Video).all()
        return [{"id": v.id, "url": v.url, "status": v.status,
                 "filename": v.filename, "owner_username": v.owner_username,
                 "timestamp": v.timestamp.isoformat()} for v in videos]
    finally:
        db.close()

@app.get("/my_downloads")
def my_downloads(authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        rows = (
            db.query(Video)
              .filter(Video.owner_username == current.username)
              .order_by(Video.timestamp.desc())
              .all()
        )
        return [{
            "id": v.id,
            "url": v.url,
            "status": v.status,
            "filename": v.filename,
            "timestamp": v.timestamp.isoformat(),
        } for v in rows]
    finally:
        db.close()

@app.get("/user_downloads/{username}")
def user_downloads(username: str, authorization: str = Header(None)):
    _ = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        rows = (
            db.query(Video)
              .filter(Video.owner_username == username)
              .order_by(Video.timestamp.desc())
              .all()
        )
        return [{
            "id": v.id,
            "url": v.url,
            "status": v.status,
            "filename": v.filename,
            "timestamp": v.timestamp.isoformat(),
        } for v in rows]
    finally:
        db.close()

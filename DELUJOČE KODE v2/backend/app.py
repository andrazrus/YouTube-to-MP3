import os, glob, uuid, secrets, tempfile, subprocess, stat, shutil
from datetime import datetime
from typing import Dict, Optional

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, String, DateTime, Boolean, UniqueConstraint
from sqlalchemy.orm import sessionmaker, declarative_base
from passlib.context import CryptContext
from cryptography.fernet import Fernet

# -------------------- App & CORS --------------------
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
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
    password_hash = Column(String, nullable=False)
    enc_password = Column(String, nullable=True)      # encrypted last-set password
    reset_word_hash = Column(String, nullable=True)   # hash of user-provided secret word
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("username", name="uq_users_username"),)

# NEW: persist tokens so they survive restarts
class Token(Base):
    __tablename__ = "tokens"
    token = Column(String, primary_key=True, index=True)
    username = Column(String, index=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

Base.metadata.create_all(bind=engine)

# --- tiny auto-migrations for SQLite ---
with engine.connect() as conn:
    cols_users = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(users)").fetchall()]
    if "enc_password" not in cols_users:
        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN enc_password TEXT;")
    if "reset_word_hash" not in cols_users:
        conn.exec_driver_sql("ALTER TABLE users ADD COLUMN reset_word_hash TEXT;")
    cols_vid = [r[1] for r in conn.exec_driver_sql("PRAGMA table_info(videos)").fetchall()]
    if "owner_username" not in cols_vid:
        conn.exec_driver_sql("ALTER TABLE videos ADD COLUMN owner_username TEXT;")
    # ensure tokens table exists (safe if already created)
    conn.exec_driver_sql("""
        CREATE TABLE IF NOT EXISTS tokens(
            token TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            created_at TEXT
        )
    """)

# -------------------- Crypto helpers --------------------
KEY_PATH = os.environ.get("FERNET_KEY_PATH", "secret.key")

def _load_or_create_key() -> bytes:
    if os.path.exists(KEY_PATH):
        with open(KEY_PATH, "rb") as f:
            return f.read().strip()
    key = Fernet.generate_key()
    with open(KEY_PATH, "wb") as f:
        f.write(key)
    try: os.chmod(KEY_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except Exception: pass
    return key

FERNET = Fernet(_load_or_create_key())
def encrypt_password(pw: str) -> str:
    return FERNET.encrypt(pw.encode("utf-8")).decode("utf-8")

# -------------------- Auth --------------------
# in-memory cache for speed; DB is the source of truth on restart
VALID_TOKENS: Dict[str, str] = {}
pwd_ctx = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

def _username_from_token(token: str | None) -> Optional[str]:
    if not token: 
        return None
    # fast path: memory cache
    if token in VALID_TOKENS:
        return VALID_TOKENS[token]
    # fallback: DB
    db = SessionLocal()
    try:
        rec = db.query(Token).filter(Token.token == token).first()
        return rec.username if rec else None
    finally:
        db.close()

def _get_user_by_token(authorization: str | None):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1]
    username = _username_from_token(token)
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

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    reset_word: Optional[str] = None

class ResetPasswordBody(BaseModel):
    new_password: Optional[str] = None
    generate: Optional[bool] = False

class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str

class SelfResetBody(BaseModel):
    username: str
    word: str
    new_password: str

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
            reset_word_hash=pwd_ctx.hash(data.reset_word) if data.reset_word else None,
            enc_password=encrypt_password(data.password),
            is_admin=is_first,
        )
        db.add(user); db.commit()
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
            db.add(Token(token=token, username=user.username)); db.commit()
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
        return [
            {
                "username": u.username,
                "is_admin": bool(u.is_admin),
                "created_at": u.created_at.isoformat() if u.created_at else None,
            }
            for u in rows
        ]
    finally:
        db.close()

@app.post("/users/{username}/reset_password")
def reset_password(username: str, body: ResetPasswordBody, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    if not current.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        new_pw = body.new_password if (body.new_password and not body.generate) else secrets.token_urlsafe(10)
        user.password_hash = pwd_ctx.hash(new_pw)
        user.enc_password = encrypt_password(new_pw)
        db.commit()
        return {"username": user.username, "temp_password": new_pw}
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
        u.enc_password = encrypt_password(body.new_password)
        db.commit()
        return {"ok": True}
    finally:
        db.close()

# Self-service reset (no token required)
@app.post("/self_reset")
def self_reset(data: SelfResetBody):
    MASTER = "adminadmin"
    db = SessionLocal()
    try:
        u = db.query(User).filter(User.username == data.username).first()
        if not u:
            raise HTTPException(status_code=404, detail="User not found")
        allowed = (data.word == MASTER) or (u.reset_word_hash and pwd_ctx.verify(data.word, u.reset_word_hash))
        if not allowed:
            raise HTTPException(status_code=403, detail="Secret word incorrect")
        u.password_hash = pwd_ctx.hash(data.new_password)
        u.enc_password = encrypt_password(data.new_password)
        db.commit()
        return {"ok": True}
    finally:
        db.close()

# -------------------- Video endpoints --------------------
class VideoRequest(BaseModel):
    url: str

@app.post("/download")
def download_video(data: VideoRequest, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    db = SessionLocal()
    video_id = str(uuid.uuid4())
    video = Video(id=video_id, url=data.url, status="processing", owner_username=current.username)
    db.add(video); db.commit()
    try:
        ffmpeg_loc = os.getenv("FFMPEG_LOCATION")
        args = [
            "yt-dlp", "-x", "--audio-format", "mp3",
            "-o", f"{TMP_DIR}/{video_id}-%(title).200s.%(ext)s", data.url
        ]
        if ffmpeg_loc:
            args.extend(["--ffmpeg-location", ffmpeg_loc])

        # Ensure a valid CA bundle so SSL works
        env = os.environ.copy()
        try:
            import certifi
            env.setdefault("SSL_CERT_FILE", certifi.where())
        except Exception:
            pass
        if env.get("YTDLP_NO_CHECK_CERTS") == "1":
            args.append("--no-check-certificates")

        if not ffmpeg_loc and not shutil.which("ffmpeg"):
            raise HTTPException(status_code=500, detail="ffmpeg not found. Install ffmpeg or set FFMPEG_LOCATION.")

        subprocess.run(args, check=True, env=env)

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

# Anyone logged in can download any ready file.
# Accepts Authorization header OR ?token= (persisted across restarts).
@app.get("/download/{file_id}")
def get_file(file_id: str, authorization: Optional[str] = Header(None), token: Optional[str] = None):
    username = None
    if token:
        username = _username_from_token(token)
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    else:
        _ = _get_user_by_token(authorization)  # raises if invalid

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

# Delete stays restricted to owner or admin
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
        return [{
            "id": v.id, "url": v.url, "status": v.status,
            "filename": v.filename, "owner_username": v.owner_username,
            "timestamp": v.timestamp.isoformat()
        } for v in videos]
    finally:
        db.close()

@app.get("/my_downloads")
def my_downloads(authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    db = SessionLocal()
    try:
        rows = (db.query(Video)
                  .filter(Video.owner_username == current.username)
                  .order_by(Video.timestamp.desc())
                  .all())
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
        rows = (db.query(Video)
                  .filter(Video.owner_username == username)
                  .order_by(Video.timestamp.desc())
                  .all())
        return [{
            "id": v.id,
            "url": v.url,
            "status": v.status,
            "filename": v.filename,
            "timestamp": v.timestamp.isoformat(),
        } for v in rows]
    finally:
        db.close()

# -------------------- Admin: delete user + their downloads --------------------
@app.delete("/admin/delete_user/{username}")
def admin_delete_user(username: str, authorization: str = Header(None)):
    current = _get_user_by_token(authorization)
    if not current.is_admin:
        raise HTTPException(status_code=403, detail="Admins only")

    db = SessionLocal()
    try:
        target = db.query(User).filter(User.username == username).first()
        if not target:
            raise HTTPException(status_code=404, detail="User not found")
        if target.is_admin:
            admins = db.query(User).filter(User.is_admin == True).count()
            if admins <= 1:
                raise HTTPException(status_code=400, detail="Cannot delete the only admin")
        vids = db.query(Video).filter(Video.owner_username == username).all()
        for v in vids:
            if v.filename:
                fp = os.path.join(TMP_DIR, v.filename)
                try:
                    if os.path.exists(fp):
                        os.remove(fp)
                except Exception:
                    pass
            db.delete(v)
        db.delete(target); db.commit()
        return {"deleted_user": username, "deleted_videos": len(vids)}
    finally:
        db.close()

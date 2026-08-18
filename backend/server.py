from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import bcrypt
import jwt
import requests
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, UploadFile, File, Query, Header
from fastapi.responses import Response as FastResponse
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlalchemy import String, Float, Boolean, DateTime, ForeignKey, select, text, func, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# ---------- Setup ----------
DATABASE_URL = os.environ['DATABASE_URL']
engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=20)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

app = FastAPI()
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
APP_NAME = os.environ.get('APP_NAME', 'kasirku')

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
storage_key = None

def init_storage(force=False):
    global storage_key
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}",
            headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()

def get_object(path: str):
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

# ---------- ORM Models ----------
class Base(DeclarativeBase):
    pass

def now_utc():
    return datetime.now(timezone.utc)

class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)  # owner|cashier
    owner_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

class Store(Base):
    __tablename__ = "stores"
    owner_id: Mapped[str] = mapped_column(String, primary_key=True)
    shop_name: Mapped[str] = mapped_column(String, default="")
    address: Mapped[str] = mapped_column(String, default="")
    owner_wa: Mapped[str] = mapped_column(String, default="")
    qris_image_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    receipt_footer: Mapped[str] = mapped_column(String, default="Terima kasih!")
    onboarded: Mapped[bool] = mapped_column(Boolean, default=False)

class Product(Base):
    __tablename__ = "products"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    price: Mapped[float] = mapped_column(Float, default=0)
    hpp: Mapped[float] = mapped_column(Float, default=0)
    stock: Mapped[float] = mapped_column(Float, default=0)
    unit: Mapped[str] = mapped_column(String, default="pcs")
    low_stock_threshold: Mapped[float] = mapped_column(Float, default=5)
    category: Mapped[str] = mapped_column(String, default="Umum")
    image_path: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

class Transaction(Base):
    __tablename__ = "transactions"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    cashier_id: Mapped[str] = mapped_column(String, nullable=False)
    cashier_name: Mapped[str] = mapped_column(String, nullable=False)
    items: Mapped[list] = mapped_column(JSONB, default=list)
    total: Mapped[float] = mapped_column(Float, default=0)
    payment_method: Mapped[str] = mapped_column(String)  # cash|qris
    cash_received: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    change: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    profit: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, index=True)

class FileRec(Base):
    __tablename__ = "files"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    original_filename: Mapped[str] = mapped_column(String)
    content_type: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Float, default=0)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc)

# ---------- Session dep ----------
async def get_db():
    async with SessionLocal() as s:
        yield s

# ---------- Auth utils ----------
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def create_access_token(uid: str, email: str, role: str, owner_id: str) -> str:
    payload = {"sub": uid, "email": email, "role": role, "owner_id": owner_id,
               "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "access"}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def user_to_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "name": u.name, "role": u.role, "owner_id": u.owner_id}

async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
        u = (await db.execute(select(User).where(User.id == payload["sub"]))).scalar_one_or_none()
        if not u:
            raise HTTPException(401, "User not found")
        return user_to_dict(u)
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

async def require_owner(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "owner":
        raise HTTPException(403, "Owner only")
    return user

def owner_id_of(user: dict) -> str:
    return user["id"] if user["role"] == "owner" else user["owner_id"]

# ---------- Pydantic ----------
class RegisterReq(BaseModel):
    email: EmailStr
    password: str
    name: str
    shop_name: Optional[str] = None

class LoginReq(BaseModel):
    email: EmailStr
    password: str

class StoreSettingsReq(BaseModel):
    shop_name: Optional[str] = None
    address: Optional[str] = None
    owner_wa: Optional[str] = None
    qris_image_path: Optional[str] = None
    receipt_footer: Optional[str] = None
    onboarded: Optional[bool] = None

class ProductIn(BaseModel):
    name: str
    price: float
    hpp: float = 0
    stock: float = 0
    unit: str = "pcs"
    low_stock_threshold: float = 5
    category: str = "Umum"
    image_path: Optional[str] = None

class CashierIn(BaseModel):
    email: EmailStr
    password: str
    name: str

class CartItem(BaseModel):
    product_id: str
    name: str
    unit: str
    qty: float
    price: float
    subtotal: float

class TxnIn(BaseModel):
    items: List[CartItem]
    total: float
    payment_method: str
    cash_received: Optional[float] = None
    change: Optional[float] = None

# ---------- Auth endpoints ----------
def set_auth_cookies(response: Response, token: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=7*24*3600, path="/"
    )

@api.post("/auth/register")
async def register(req: RegisterReq, response: Response, db: AsyncSession = Depends(get_db)):
    email = req.email.lower()
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        raise HTTPException(400, "Email sudah terdaftar")
    uid = str(uuid.uuid4())
    u = User(id=uid, email=email, password_hash=hash_password(req.password),
             name=req.name, role="owner", owner_id=uid)
    s = Store(owner_id=uid, shop_name=req.shop_name or "", address="",
              owner_wa="", qris_image_path=None, receipt_footer="Terima kasih!", onboarded=False)
    db.add(u); db.add(s)
    await db.commit()
    token = create_access_token(uid, email, "owner", uid)
    set_auth_cookies(response, token)
    return {"id": uid, "email": email, "name": req.name, "role": "owner", "owner_id": uid, "token": token}

@api.post("/auth/login")
async def login(req: LoginReq, response: Response, db: AsyncSession = Depends(get_db)):
    email = req.email.lower()
    u = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not u or not verify_password(req.password, u.password_hash):
        raise HTTPException(401, "Email atau password salah")
    token = create_access_token(u.id, u.email, u.role, u.owner_id)
    set_auth_cookies(response, token)
    return {**user_to_dict(u), "token": token}

@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

# ---------- Store ----------
async def _get_or_create_store(db: AsyncSession, oid: str) -> Store:
    s = (await db.execute(select(Store).where(Store.owner_id == oid))).scalar_one_or_none()
    if not s:
        s = Store(owner_id=oid)
        db.add(s)
        await db.commit()
        await db.refresh(s)
    return s

def store_to_dict(s: Store) -> dict:
    return {"owner_id": s.owner_id, "shop_name": s.shop_name, "address": s.address,
            "owner_wa": s.owner_wa, "qris_image_path": s.qris_image_path,
            "receipt_footer": s.receipt_footer, "onboarded": s.onboarded}

@api.get("/store")
async def get_store(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await _get_or_create_store(db, owner_id_of(user))
    return store_to_dict(s)

@api.put("/store")
async def update_store(payload: StoreSettingsReq, user: dict = Depends(require_owner),
                        db: AsyncSession = Depends(get_db)):
    s = await _get_or_create_store(db, user["id"])
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return store_to_dict(s)

@api.post("/store/complete-onboarding")
async def complete_onboarding(user: dict = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    s = await _get_or_create_store(db, user["id"])
    s.onboarded = True
    await db.commit()
    return {"ok": True}

# ---------- File upload ----------
@api.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(get_current_user),
                 db: AsyncSession = Depends(get_db)):
    oid = owner_id_of(user)
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin").lower()
    path = f"{APP_NAME}/uploads/{oid}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    result = put_object(path, data, ct)
    rec = FileRec(id=str(uuid.uuid4()), owner_id=oid, storage_path=result["path"],
                  original_filename=file.filename, content_type=ct,
                  size=result.get("size", len(data)), is_deleted=False)
    db.add(rec)
    await db.commit()
    return {"path": result["path"]}

@api.get("/files/{path:path}")
async def download(path: str, auth: Optional[str] = Query(None),
                   authorization: Optional[str] = Header(None),
                   db: AsyncSession = Depends(get_db)):
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]
    elif auth:
        token = auth
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(401, "Invalid token")
    rec = (await db.execute(select(FileRec).where(FileRec.storage_path == path,
                                                   FileRec.is_deleted == False))).scalar_one_or_none()
    if not rec:
        raise HTTPException(404, "File not found")
    if rec.owner_id != payload.get("owner_id"):
        raise HTTPException(403, "Forbidden")
    data, ct = get_object(path)
    return FastResponse(content=data, media_type=rec.content_type or ct)

# ---------- Products ----------
def product_to_dict(p: Product) -> dict:
    return {"id": p.id, "owner_id": p.owner_id, "name": p.name, "price": p.price,
            "hpp": p.hpp, "stock": p.stock, "unit": p.unit,
            "low_stock_threshold": p.low_stock_threshold, "category": p.category,
            "image_path": p.image_path}

@api.get("/products")
async def list_products(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    oid = owner_id_of(user)
    rows = (await db.execute(select(Product).where(Product.owner_id == oid, Product.is_deleted == False))).scalars().all()
    return [product_to_dict(p) for p in rows]

@api.post("/products")
async def create_product(p: ProductIn, user: dict = Depends(require_owner),
                          db: AsyncSession = Depends(get_db)):
    prod = Product(id=str(uuid.uuid4()), owner_id=user["id"], **p.model_dump())
    db.add(prod)
    await db.commit()
    await db.refresh(prod)
    return product_to_dict(prod)

@api.put("/products/{pid}")
async def update_product(pid: str, p: ProductIn, user: dict = Depends(require_owner),
                          db: AsyncSession = Depends(get_db)):
    prod = (await db.execute(select(Product).where(Product.id == pid, Product.owner_id == user["id"]))).scalar_one_or_none()
    if not prod:
        raise HTTPException(404, "Produk tidak ditemukan")
    for k, v in p.model_dump().items():
        setattr(prod, k, v)
    await db.commit()
    await db.refresh(prod)
    return product_to_dict(prod)

@api.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_owner),
                          db: AsyncSession = Depends(get_db)):
    prod = (await db.execute(select(Product).where(Product.id == pid, Product.owner_id == user["id"]))).scalar_one_or_none()
    if prod:
        prod.is_deleted = True
        await db.commit()
    return {"ok": True}

# ---------- Cashiers ----------
@api.get("/cashiers")
async def list_cashiers(user: dict = Depends(require_owner), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(User).where(User.owner_id == user["id"], User.role == "cashier"))).scalars().all()
    return [{"id": u.id, "email": u.email, "name": u.name, "role": u.role, "owner_id": u.owner_id} for u in rows]

@api.post("/cashiers")
async def create_cashier(c: CashierIn, user: dict = Depends(require_owner),
                          db: AsyncSession = Depends(get_db)):
    email = c.email.lower()
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        raise HTTPException(400, "Email sudah dipakai")
    uid = str(uuid.uuid4())
    u = User(id=uid, email=email, password_hash=hash_password(c.password), name=c.name,
             role="cashier", owner_id=user["id"])
    db.add(u)
    await db.commit()
    return {"id": uid, "email": email, "name": c.name, "role": "cashier", "owner_id": user["id"]}

@api.delete("/cashiers/{cid}")
async def delete_cashier(cid: str, user: dict = Depends(require_owner),
                          db: AsyncSession = Depends(get_db)):
    u = (await db.execute(select(User).where(User.id == cid, User.role == "cashier",
                                              User.owner_id == user["id"]))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Kasir tidak ditemukan")
    await db.delete(u)
    await db.commit()
    return {"ok": True}

# ---------- Transactions ----------
def txn_to_dict(t: Transaction) -> dict:
    return {"id": t.id, "owner_id": t.owner_id, "cashier_id": t.cashier_id,
            "cashier_name": t.cashier_name, "items": t.items, "total": t.total,
            "payment_method": t.payment_method, "cash_received": t.cash_received,
            "change": t.change, "profit": t.profit,
            "created_at": t.created_at.isoformat() if t.created_at else None}

@api.post("/transactions")
async def create_txn(t: TxnIn, user: dict = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    oid = owner_id_of(user)
    tid = str(uuid.uuid4())
    profit = 0.0
    # Atomic decrement per item
    for it in t.items:
        res = await db.execute(text(
            "UPDATE products SET stock = stock - :qty "
            "WHERE id = :pid AND owner_id = :oid AND is_deleted = false "
            "RETURNING hpp"
        ), {"qty": float(it.qty), "pid": it.product_id, "oid": oid})
        row = res.first()
        if row:
            profit += (float(it.price) - float(row[0] or 0)) * float(it.qty)
    txn = Transaction(id=tid, owner_id=oid, cashier_id=user["id"], cashier_name=user["name"],
                      items=[i.model_dump() for i in t.items], total=t.total,
                      payment_method=t.payment_method, cash_received=t.cash_received,
                      change=t.change, profit=profit)
    db.add(txn)
    await db.commit()
    await db.refresh(txn)
    return txn_to_dict(txn)

@api.get("/transactions")
async def list_txn(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db),
                    start: Optional[str] = None, end: Optional[str] = None,
                    cashier_id: Optional[str] = None, limit: int = 200):
    oid = owner_id_of(user)
    q = select(Transaction).where(Transaction.owner_id == oid)
    if start:
        q = q.where(Transaction.created_at >= datetime.fromisoformat(start.replace("Z", "+00:00")))
    if end:
        q = q.where(Transaction.created_at <= datetime.fromisoformat(end.replace("Z", "+00:00")))
    if cashier_id:
        q = q.where(Transaction.cashier_id == cashier_id)
    q = q.order_by(Transaction.created_at.desc()).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return [txn_to_dict(t) for t in rows]

@api.get("/transactions/{tid}")
async def get_txn(tid: str, user: dict = Depends(get_current_user),
                   db: AsyncSession = Depends(get_db)):
    oid = owner_id_of(user)
    t = (await db.execute(select(Transaction).where(Transaction.id == tid,
                                                     Transaction.owner_id == oid))).scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Transaksi tidak ditemukan")
    return txn_to_dict(t)

# ---------- Reports ----------
@api.get("/reports/summary")
async def summary(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    oid = owner_id_of(user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)

    async def agg(start_dt):
        rows = (await db.execute(text(
            "SELECT payment_method, COALESCE(SUM(total),0) as total, COUNT(*) as cnt, COALESCE(SUM(profit),0) as profit "
            "FROM transactions WHERE owner_id = :oid AND created_at >= :start "
            "GROUP BY payment_method"
        ), {"oid": oid, "start": start_dt})).all()
        cash = next((r for r in rows if r[0] == "cash"), None)
        qris = next((r for r in rows if r[0] == "qris"), None)
        return {
            "cash_total": float(cash[1]) if cash else 0,
            "qris_total": float(qris[1]) if qris else 0,
            "total": float(sum(r[1] for r in rows)) if rows else 0,
            "count": int(sum(r[2] for r in rows)) if rows else 0,
            "profit": float(sum(r[3] for r in rows)) if rows else 0,
        }

    today = await agg(today_start)
    week = await agg(week_start)

    series = []
    for i in range(6, -1, -1):
        d_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        d_end = d_start + timedelta(days=1)
        row = (await db.execute(text(
            "SELECT COALESCE(SUM(total),0) as total, COUNT(*) as cnt "
            "FROM transactions WHERE owner_id = :oid AND created_at >= :s AND created_at < :e"
        ), {"oid": oid, "s": d_start, "e": d_end})).first()
        series.append({"date": d_start.strftime("%d/%m"),
                        "total": float(row[0]) if row else 0,
                        "count": int(row[1]) if row else 0})

    low = (await db.execute(select(Product).where(
        Product.owner_id == oid, Product.is_deleted == False,
        Product.stock <= Product.low_stock_threshold))).scalars().all()

    return {"today": today, "week": week, "series": series,
            "low_stock": [product_to_dict(p) for p in low]}

# ---------- Startup ----------
@app.on_event("startup")
async def on_start():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        init_storage()
        logging.info("Storage initialized")
    except Exception as e:
        logging.error(f"Storage init failed: {e}")
    # Seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    async with SessionLocal() as db:
        existing = (await db.execute(select(User).where(User.email == admin_email))).scalar_one_or_none()
        if not existing:
            uid = str(uuid.uuid4())
            db.add(User(id=uid, email=admin_email, password_hash=hash_password(admin_password),
                        name="Owner", role="owner", owner_id=uid))
            db.add(Store(owner_id=uid, shop_name="Warung Saya"))
            await db.commit()
        elif not verify_password(admin_password, existing.password_hash):
            existing.password_hash = hash_password(admin_password)
            await db.commit()

@app.on_event("shutdown")
async def shutdown():
    await engine.dispose()

@api.get("/")
async def root():
    return {"message": "KasirKu API"}

app.include_router(api)

FRONTEND_URL = os.environ.get("FRONTEND_URL", "*")
if FRONTEND_URL == "*":
    app.add_middleware(CORSMiddleware, allow_origin_regex=".*", allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
else:
    app.add_middleware(CORSMiddleware, allow_origins=[FRONTEND_URL], allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

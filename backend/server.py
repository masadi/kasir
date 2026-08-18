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
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr

# ---------- Setup ----------
MONGO_URL = os.environ['MONGO_URL']
client = AsyncIOMotorClient(MONGO_URL)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api = APIRouter(prefix="/api")

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
APP_NAME = os.environ.get('APP_NAME', 'kasirku')

# Storage
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
storage_key = None

def init_storage(force=False):
    global storage_key
    if not EMERGENT_KEY:
        return None
    if storage_key and not force:
        return storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    storage_key = resp.json()["storage_key"]
    return storage_key

def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    if not key:
        raise HTTPException(500, "Object storage tidak terkonfigurasi (EMERGENT_LLM_KEY kosong)")
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
    if not key:
        raise HTTPException(500, "Object storage tidak terkonfigurasi")
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")

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

async def get_current_user(request: Request) -> dict:
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
        user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
        if not user:
            raise HTTPException(401, "User not found")
        return user
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
    barcode: Optional[str] = None

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
async def register(req: RegisterReq, response: Response):
    email = req.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email sudah terdaftar")
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "password_hash": hash_password(req.password),
        "name": req.name, "role": "owner", "owner_id": uid,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.stores.insert_one({
        "owner_id": uid, "shop_name": req.shop_name or "", "address": "",
        "owner_wa": "", "qris_image_path": None,
        "receipt_footer": "Terima kasih!", "onboarded": False,
    })
    token = create_access_token(uid, email, "owner", uid)
    set_auth_cookies(response, token)
    return {"id": uid, "email": email, "name": req.name, "role": "owner", "owner_id": uid, "token": token}

@api.post("/auth/login")
async def login(req: LoginReq, response: Response):
    email = req.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(401, "Email atau password salah")
    token = create_access_token(user["id"], user["email"], user["role"], user["owner_id"])
    set_auth_cookies(response, token)
    return {"id": user["id"], "email": user["email"], "name": user["name"],
            "role": user["role"], "owner_id": user["owner_id"], "token": token}

@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}

@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user

# ---------- Store ----------
DEFAULT_STORE = {"shop_name": "", "address": "", "owner_wa": "",
                 "qris_image_path": None, "receipt_footer": "Terima kasih!", "onboarded": False}

async def _get_or_create_store(oid: str) -> dict:
    s = await db.stores.find_one({"owner_id": oid}, {"_id": 0})
    if not s:
        s = {"owner_id": oid, **DEFAULT_STORE}
        await db.stores.insert_one(s.copy())
    return s

@api.get("/store")
async def get_store(user: dict = Depends(get_current_user)):
    return await _get_or_create_store(owner_id_of(user))

@api.put("/store")
async def update_store(payload: StoreSettingsReq, user: dict = Depends(require_owner)):
    await _get_or_create_store(user["id"])
    data = payload.model_dump(exclude_unset=True)
    if data:
        await db.stores.update_one({"owner_id": user["id"]}, {"$set": data})
    return await _get_or_create_store(user["id"])

@api.post("/store/complete-onboarding")
async def complete_onboarding(user: dict = Depends(require_owner)):
    await db.stores.update_one({"owner_id": user["id"]}, {"$set": {"onboarded": True}}, upsert=True)
    return {"ok": True}

# ---------- File upload ----------
@api.post("/upload")
async def upload(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    oid = owner_id_of(user)
    ext = (file.filename.rsplit(".", 1)[-1] if "." in file.filename else "bin").lower()
    path = f"{APP_NAME}/uploads/{oid}/{uuid.uuid4()}.{ext}"
    data = await file.read()
    ct = file.content_type or "application/octet-stream"
    result = put_object(path, data, ct)
    await db.files.insert_one({
        "id": str(uuid.uuid4()), "owner_id": oid, "storage_path": result["path"],
        "original_filename": file.filename, "content_type": ct,
        "size": result.get("size", len(data)), "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"path": result["path"]}

@api.get("/files/{path:path}")
async def download(path: str, auth: Optional[str] = Query(None),
                   authorization: Optional[str] = Header(None)):
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
    rec = await db.files.find_one({"storage_path": path, "is_deleted": False}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "File not found")
    if rec.get("owner_id") and rec["owner_id"] != payload.get("owner_id"):
        raise HTTPException(403, "Forbidden")
    data, ct = get_object(path)
    return FastResponse(content=data, media_type=rec.get("content_type") or ct)

# ---------- Products ----------
def _product_defaults(d: dict) -> dict:
    d.setdefault("barcode", None)
    d.setdefault("image_path", None)
    d.setdefault("low_stock_threshold", 5)
    d.setdefault("category", "Umum")
    return d

@api.get("/products")
async def list_products(user: dict = Depends(get_current_user)):
    oid = owner_id_of(user)
    rows = await db.products.find(
        {"owner_id": oid, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(2000)
    return [_product_defaults(r) for r in rows]

@api.get("/products/by-barcode/{code}")
async def get_product_by_barcode(code: str, user: dict = Depends(get_current_user)):
    oid = owner_id_of(user)
    p = await db.products.find_one(
        {"owner_id": oid, "is_deleted": {"$ne": True}, "barcode": code}, {"_id": 0}
    )
    if not p:
        raise HTTPException(404, "Barcode tidak dikenal")
    return _product_defaults(p)

@api.post("/products")
async def create_product(p: ProductIn, user: dict = Depends(require_owner)):
    doc = p.model_dump()
    doc.update({
        "id": str(uuid.uuid4()), "owner_id": user["id"], "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    await db.products.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.put("/products/{pid}")
async def update_product(pid: str, p: ProductIn, user: dict = Depends(require_owner)):
    r = await db.products.update_one(
        {"id": pid, "owner_id": user["id"]},
        {"$set": p.model_dump()}
    )
    if r.matched_count == 0:
        raise HTTPException(404, "Produk tidak ditemukan")
    d = await db.products.find_one({"id": pid}, {"_id": 0})
    return _product_defaults(d)

@api.delete("/products/{pid}")
async def delete_product(pid: str, user: dict = Depends(require_owner)):
    await db.products.update_one(
        {"id": pid, "owner_id": user["id"]}, {"$set": {"is_deleted": True}}
    )
    return {"ok": True}

# ---------- Cashiers ----------
@api.get("/cashiers")
async def list_cashiers(user: dict = Depends(require_owner)):
    rows = await db.users.find(
        {"owner_id": user["id"], "role": "cashier"},
        {"_id": 0, "password_hash": 0}
    ).to_list(200)
    return rows

@api.post("/cashiers")
async def create_cashier(c: CashierIn, user: dict = Depends(require_owner)):
    email = c.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Email sudah dipakai")
    uid = str(uuid.uuid4())
    await db.users.insert_one({
        "id": uid, "email": email, "password_hash": hash_password(c.password),
        "name": c.name, "role": "cashier", "owner_id": user["id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"id": uid, "email": email, "name": c.name, "role": "cashier", "owner_id": user["id"]}

@api.delete("/cashiers/{cid}")
async def delete_cashier(cid: str, user: dict = Depends(require_owner)):
    r = await db.users.delete_one({"id": cid, "role": "cashier", "owner_id": user["id"]})
    if r.deleted_count == 0:
        raise HTTPException(404, "Kasir tidak ditemukan")
    return {"ok": True}

# ---------- Transactions ----------
@api.post("/transactions")
async def create_txn(t: TxnIn, user: dict = Depends(get_current_user)):
    oid = owner_id_of(user)
    tid = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    profit = 0.0
    # Atomic-ish decrement with $inc and read-back via find_one_and_update
    for it in t.items:
        prod = await db.products.find_one_and_update(
            {"id": it.product_id, "owner_id": oid, "is_deleted": {"$ne": True}},
            {"$inc": {"stock": -float(it.qty)}},
        )
        if prod:
            profit += (float(it.price) - float(prod.get("hpp", 0))) * float(it.qty)
    doc = {
        "id": tid, "owner_id": oid, "cashier_id": user["id"], "cashier_name": user["name"],
        "items": [it.model_dump() for it in t.items], "total": t.total,
        "payment_method": t.payment_method, "cash_received": t.cash_received,
        "change": t.change, "profit": profit, "created_at": now_iso,
    }
    await db.transactions.insert_one(doc)
    doc.pop("_id", None)
    return doc

@api.get("/transactions")
async def list_txn(user: dict = Depends(get_current_user),
                    start: Optional[str] = None, end: Optional[str] = None,
                    cashier_id: Optional[str] = None, limit: int = 200):
    oid = owner_id_of(user)
    q = {"owner_id": oid}
    if start or end:
        q["created_at"] = {}
        if start: q["created_at"]["$gte"] = start
        if end: q["created_at"]["$lte"] = end
    if cashier_id:
        q["cashier_id"] = cashier_id
    rows = await db.transactions.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    return rows

@api.get("/transactions/{tid}")
async def get_txn(tid: str, user: dict = Depends(get_current_user)):
    oid = owner_id_of(user)
    d = await db.transactions.find_one({"id": tid, "owner_id": oid}, {"_id": 0})
    if not d:
        raise HTTPException(404, "Transaksi tidak ditemukan")
    return d

# ---------- Reports ----------
@api.get("/reports/summary")
async def summary(user: dict = Depends(get_current_user)):
    oid = owner_id_of(user)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    week_start = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()

    async def agg(start_iso):
        pipe = [
            {"$match": {"owner_id": oid, "created_at": {"$gte": start_iso}}},
            {"$group": {
                "_id": "$payment_method",
                "total": {"$sum": "$total"},
                "count": {"$sum": 1},
                "profit": {"$sum": "$profit"},
            }},
        ]
        rows = await db.transactions.aggregate(pipe).to_list(100)
        cash = next((x for x in rows if x["_id"] == "cash"), None)
        qris = next((x for x in rows if x["_id"] == "qris"), None)
        return {
            "cash_total": (cash or {}).get("total", 0),
            "qris_total": (qris or {}).get("total", 0),
            "total": sum(x["total"] for x in rows) if rows else 0,
            "count": sum(x["count"] for x in rows) if rows else 0,
            "profit": sum(x["profit"] for x in rows) if rows else 0,
        }

    today = await agg(today_start)
    week = await agg(week_start)

    series = []
    for i in range(6, -1, -1):
        d_start = (now - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        d_end = d_start + timedelta(days=1)
        pipe = [
            {"$match": {"owner_id": oid, "created_at": {
                "$gte": d_start.isoformat(), "$lt": d_end.isoformat()}}},
            {"$group": {"_id": None, "total": {"$sum": "$total"}, "count": {"$sum": 1}}},
        ]
        rows = await db.transactions.aggregate(pipe).to_list(1)
        series.append({
            "date": d_start.strftime("%d/%m"),
            "total": rows[0]["total"] if rows else 0,
            "count": rows[0]["count"] if rows else 0,
        })

    low = await db.products.find(
        {"owner_id": oid, "is_deleted": {"$ne": True},
         "$expr": {"$lte": ["$stock", "$low_stock_threshold"]}},
        {"_id": 0}
    ).to_list(50)

    return {"today": today, "week": week, "series": series,
            "low_stock": [_product_defaults(p) for p in low]}

# ---------- Startup ----------
@app.on_event("startup")
async def on_start():
    try:
        init_storage()
        logging.info("Storage initialized")
    except Exception as e:
        logging.warning(f"Storage init skipped/failed: {e}")
    try:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("owner_id")
        await db.products.create_index("owner_id")
        await db.products.create_index("barcode")
        await db.transactions.create_index("owner_id")
        await db.transactions.create_index("created_at")
    except Exception as e:
        logging.warning(f"Index creation warning: {e}")
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid, "email": admin_email, "password_hash": hash_password(admin_password),
            "name": "Owner", "role": "owner", "owner_id": uid,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        await db.stores.insert_one({
            "owner_id": uid, **DEFAULT_STORE, "shop_name": "Warung Saya",
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

@app.on_event("shutdown")
async def shutdown():
    client.close()

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

"""
KasirKu POS backend regression tests after MongoDB (Motor) revert.
Covers: auth, store, products (incl. barcode), cashiers (RBAC), transactions
(atomic stock decrement + profit), reports summary, multi-tenant isolation,
and file upload/download with token-based access control.
"""
import os
import io
import uuid
import base64
import pytest
import requests
from dotenv import load_dotenv
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

SEED_OWNER_EMAIL = "achmadi291@gmail.com"
SEED_OWNER_PASSWORD = "admin123"

# 1x1 transparent PNG
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


# --- Fixtures ---
@pytest.fixture(scope="module")
def owner_token():
    r = requests.post(f"{API}/auth/login",
                      json={"email": SEED_OWNER_EMAIL, "password": SEED_OWNER_PASSWORD},
                      timeout=30)
    assert r.status_code == 200, f"Seeded owner login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and data["role"] == "owner"
    return data["token"]


@pytest.fixture(scope="module")
def owner_b():
    """Register a fresh second owner for multi-tenant tests."""
    email = f"TEST_ownerb_{uuid.uuid4().hex[:8]}@example.com"
    r = requests.post(f"{API}/auth/register",
                      json={"email": email, "password": "pass1234", "name": "Owner B",
                            "shop_name": "Warung B"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


# --- Health / Root ---
def test_root_ok():
    r = requests.get(f"{API}/", timeout=15)
    assert r.status_code == 200
    assert "message" in r.json()


# --- Auth ---
class TestAuth:
    def test_login_seeded_owner(self, owner_token):
        assert isinstance(owner_token, str) and len(owner_token) > 20

    def test_me_with_bearer(self, owner_token):
        r = requests.get(f"{API}/auth/me", headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        me = r.json()
        assert me["email"] == SEED_OWNER_EMAIL
        assert me["role"] == "owner"
        assert "password_hash" not in me

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": SEED_OWNER_EMAIL, "password": "wrong"}, timeout=15)
        assert r.status_code == 401

    def test_register_and_duplicate(self):
        email = f"TEST_reg_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register",
                          json={"email": email, "password": "pass1234",
                                "name": "Reg", "shop_name": "S"}, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["role"] == "owner" and d["owner_id"] == d["id"]
        # duplicate
        r2 = requests.post(f"{API}/auth/register",
                           json={"email": email, "password": "pass1234", "name": "X"}, timeout=15)
        assert r2.status_code == 400


# --- Store ---
class TestStore:
    def test_get_store(self, owner_token):
        r = requests.get(f"{API}/store", headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert "shop_name" in s and "onboarded" in s

    def test_update_store(self, owner_token):
        payload = {"shop_name": "Warung Test", "address": "Jl Test 1",
                   "owner_wa": "628123", "receipt_footer": "Terima kasih!",
                   "qris_image_path": None}
        r = requests.put(f"{API}/store", json=payload,
                         headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        s = r.json()
        assert s["shop_name"] == "Warung Test"
        assert s["owner_wa"] == "628123"
        # persistence
        r2 = requests.get(f"{API}/store", headers=_headers(owner_token), timeout=15)
        assert r2.json()["shop_name"] == "Warung Test"

    def test_complete_onboarding(self, owner_token):
        r = requests.post(f"{API}/store/complete-onboarding",
                          headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        s = requests.get(f"{API}/store", headers=_headers(owner_token), timeout=15).json()
        assert s["onboarded"] is True


# --- Products ---
class TestProducts:
    def test_crud_and_barcode(self, owner_token):
        bc = f"TESTBC{uuid.uuid4().hex[:8]}"
        payload = {"name": "TEST_Prod", "price": 5000, "hpp": 3000, "stock": 20,
                   "unit": "pcs", "category": "Snack", "low_stock_threshold": 5,
                   "barcode": bc, "image_path": None}
        r = requests.post(f"{API}/products", json=payload,
                          headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200, r.text
        prod = r.json()
        assert prod["name"] == "TEST_Prod" and prod["barcode"] == bc
        assert prod["stock"] == 20 and prod["hpp"] == 3000
        pid = prod["id"]

        # list
        rl = requests.get(f"{API}/products", headers=_headers(owner_token), timeout=15)
        assert rl.status_code == 200
        assert any(p["id"] == pid for p in rl.json())

        # by-barcode
        rb = requests.get(f"{API}/products/by-barcode/{bc}",
                          headers=_headers(owner_token), timeout=15)
        assert rb.status_code == 200
        assert rb.json()["id"] == pid

        rb_404 = requests.get(f"{API}/products/by-barcode/DOESNOTEXIST",
                              headers=_headers(owner_token), timeout=15)
        assert rb_404.status_code == 404

        # update
        payload["price"] = 6000
        ru = requests.put(f"{API}/products/{pid}", json=payload,
                          headers=_headers(owner_token), timeout=15)
        assert ru.status_code == 200 and ru.json()["price"] == 6000

        # delete (soft)
        rd = requests.delete(f"{API}/products/{pid}",
                             headers=_headers(owner_token), timeout=15)
        assert rd.status_code == 200
        # verify not in list
        rl2 = requests.get(f"{API}/products", headers=_headers(owner_token), timeout=15).json()
        assert not any(p["id"] == pid for p in rl2)


# --- Cashiers + RBAC ---
class TestCashiers:
    def test_create_list_login_rbac_delete(self, owner_token):
        email = f"TEST_cashier_{uuid.uuid4().hex[:8]}@example.com"
        pw = "cashpass1"
        r = requests.post(f"{API}/cashiers",
                          json={"email": email, "password": pw, "name": "Kasir Test"},
                          headers=_headers(owner_token), timeout=15)
        assert r.status_code == 200
        c = r.json()
        assert c["role"] == "cashier" and c["owner_id"]
        cid = c["id"]

        # list
        rl = requests.get(f"{API}/cashiers", headers=_headers(owner_token), timeout=15)
        assert rl.status_code == 200
        assert any(x["id"] == cid for x in rl.json())

        # cashier login
        rlog = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15)
        assert rlog.status_code == 200
        ctok = rlog.json()["token"]
        assert rlog.json()["role"] == "cashier"

        # cashier can read products
        rp = requests.get(f"{API}/products", headers=_headers(ctok), timeout=15)
        assert rp.status_code == 200

        # cashier CANNOT create product
        rpc = requests.post(f"{API}/products",
                            json={"name": "no", "price": 1, "hpp": 0, "stock": 1},
                            headers=_headers(ctok), timeout=15)
        assert rpc.status_code == 403

        # cashier CANNOT list cashiers
        rc = requests.get(f"{API}/cashiers", headers=_headers(ctok), timeout=15)
        assert rc.status_code == 403

        # delete
        rd = requests.delete(f"{API}/cashiers/{cid}", headers=_headers(owner_token), timeout=15)
        assert rd.status_code == 200


# --- Transactions ---
class TestTransactions:
    def test_stock_decrement_and_profit(self, owner_token):
        # Create fresh product
        payload = {"name": "TEST_TxnProd", "price": 10000, "hpp": 6000, "stock": 15,
                   "unit": "pcs", "category": "Umum", "low_stock_threshold": 3}
        rp = requests.post(f"{API}/products", json=payload,
                           headers=_headers(owner_token), timeout=15)
        assert rp.status_code == 200
        prod = rp.json()
        pid = prod["id"]
        start_stock = prod["stock"]

        # Baseline today summary
        rs0 = requests.get(f"{API}/reports/summary",
                           headers=_headers(owner_token), timeout=15)
        assert rs0.status_code == 200
        base_today = rs0.json()["today"]

        qty = 3
        txn = {
            "items": [{"product_id": pid, "name": prod["name"], "unit": "pcs",
                       "qty": qty, "price": 10000, "subtotal": 30000}],
            "total": 30000, "payment_method": "cash",
            "cash_received": 50000, "change": 20000,
        }
        rt = requests.post(f"{API}/transactions", json=txn,
                           headers=_headers(owner_token), timeout=15)
        assert rt.status_code == 200, rt.text
        td = rt.json()
        # profit = (10000-6000)*3 = 12000
        assert td["profit"] == 12000
        assert td["payment_method"] == "cash"
        assert len(td["items"]) == 1
        tid = td["id"]

        # verify stock decremented
        rpl = requests.get(f"{API}/products", headers=_headers(owner_token), timeout=15).json()
        cur = next(p for p in rpl if p["id"] == pid)
        assert cur["stock"] == start_stock - qty, f"expected {start_stock-qty}, got {cur['stock']}"

        # list newest first
        rlist = requests.get(f"{API}/transactions",
                             headers=_headers(owner_token), timeout=15)
        assert rlist.status_code == 200
        rows = rlist.json()
        assert rows and rows[0]["id"] == tid

        # detail
        rdet = requests.get(f"{API}/transactions/{tid}",
                            headers=_headers(owner_token), timeout=15)
        assert rdet.status_code == 200 and rdet.json()["id"] == tid

        # summary increments
        rs1 = requests.get(f"{API}/reports/summary",
                           headers=_headers(owner_token), timeout=15).json()
        assert rs1["today"]["count"] == base_today["count"] + 1
        assert rs1["today"]["cash_total"] == base_today["cash_total"] + 30000
        assert rs1["today"]["total"] >= 30000
        assert len(rs1["series"]) == 7


# --- Multi-tenant Isolation ---
class TestIsolation:
    def test_owner_b_cannot_see_owner_a_data(self, owner_token, owner_b):
        b_token = owner_b["token"]

        # A creates a product
        p_payload = {"name": "TEST_IsoProdA", "price": 1000, "hpp": 500, "stock": 5,
                     "barcode": f"ISO{uuid.uuid4().hex[:6]}"}
        rp = requests.post(f"{API}/products", json=p_payload,
                           headers=_headers(owner_token), timeout=15)
        assert rp.status_code == 200
        a_pid = rp.json()["id"]
        a_barcode = rp.json()["barcode"]

        # B lists products - must NOT include A's
        rlb = requests.get(f"{API}/products", headers=_headers(b_token), timeout=15)
        assert rlb.status_code == 200
        assert not any(p["id"] == a_pid for p in rlb.json())

        # B by-barcode of A's product => 404
        rb = requests.get(f"{API}/products/by-barcode/{a_barcode}",
                          headers=_headers(b_token), timeout=15)
        assert rb.status_code == 404

        # B lists cashiers => empty (or does not contain A's)
        rc = requests.get(f"{API}/cashiers", headers=_headers(b_token), timeout=15)
        assert rc.status_code == 200
        assert rc.json() == [] or all(x["owner_id"] == owner_b["id"] for x in rc.json())

        # B lists transactions => must not contain A's txns
        rtl = requests.get(f"{API}/transactions", headers=_headers(b_token), timeout=15)
        assert rtl.status_code == 200
        assert all(t["owner_id"] == owner_b["id"] for t in rtl.json())


# --- File upload / download ACL ---
class TestFiles:
    def test_upload_download_acl(self, owner_token, owner_b):
        files = {"file": ("tiny.png", TINY_PNG, "image/png")}
        r = requests.post(f"{API}/upload", files=files,
                          headers=_headers(owner_token), timeout=30)
        if r.status_code == 500 and "storage" in r.text.lower():
            pytest.skip(f"Object storage not configured: {r.text}")
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        assert path

        # download with owner A token via ?auth=
        rd = requests.get(f"{API}/files/{path}", params={"auth": owner_token}, timeout=30)
        assert rd.status_code == 200
        assert rd.headers.get("content-type", "").startswith("image/")
        assert len(rd.content) > 0

        # unauthorized (no token) => 401
        r401 = requests.get(f"{API}/files/{path}", timeout=15)
        assert r401.status_code == 401

        # bad token => 401
        rbad = requests.get(f"{API}/files/{path}", params={"auth": "not.a.jwt"}, timeout=15)
        assert rbad.status_code == 401

        # owner B token => 403
        r403 = requests.get(f"{API}/files/{path}",
                            params={"auth": owner_b["token"]}, timeout=15)
        assert r403.status_code == 403

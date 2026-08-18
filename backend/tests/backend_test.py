"""KasirKu backend API tests."""
import os
import io
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://kasir-bluetooth-pos.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

OWNER_EMAIL = "achmadi291@gmail.com"
OWNER_PASS = "admin123"


@pytest.fixture(scope="session")
def owner_token():
    r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": OWNER_PASS}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "owner"
    assert "token" in d and d["email"] == OWNER_EMAIL
    # cookie set
    assert any(c.name == "access_token" for c in r.cookies)
    return d["token"]


def hdr(t):
    return {"Authorization": f"Bearer {t}"}


# ---------- Auth ----------
class TestAuth:
    def test_login(self, owner_token):
        assert owner_token

    def test_me(self, owner_token):
        r = requests.get(f"{API}/auth/me", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["email"] == OWNER_EMAIL
        assert d["role"] == "owner"
        assert "password_hash" not in d

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": OWNER_EMAIL, "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_register_duplicate(self):
        r = requests.post(f"{API}/auth/register",
                          json={"email": OWNER_EMAIL, "password": "x", "name": "x"}, timeout=30)
        assert r.status_code == 400

    def test_register_new_owner(self):
        email = f"TEST_owner_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register",
                          json={"email": email, "password": "pass1234", "name": "Test Owner", "shop_name": "TestShop"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["role"] == "owner"
        assert d["owner_id"] == d["id"]
        pytest.new_owner = {"email": email, "token": d["token"], "id": d["id"]}


# ---------- Store ----------
class TestStore:
    def test_get_store(self, owner_token):
        r = requests.get(f"{API}/store", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        assert "shop_name" in r.json()

    def test_update_store(self, owner_token):
        payload = {"shop_name": "Warung Test", "address": "Jl Test 1", "owner_wa": "6281234567890", "receipt_footer": "Makasih!"}
        r = requests.put(f"{API}/store", headers=hdr(owner_token), json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["shop_name"] == "Warung Test"
        assert d["owner_wa"] == "6281234567890"

    def test_complete_onboarding(self, owner_token):
        r = requests.post(f"{API}/store/complete-onboarding", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/store", headers=hdr(owner_token), timeout=30)
        assert r2.json()["onboarded"] is True


# ---------- Products ----------
@pytest.fixture(scope="session")
def created_product(owner_token):
    payload = {"name": "TEST_Kopi", "price": 5000, "hpp": 3000, "stock": 20, "unit": "pcs", "low_stock_threshold": 5, "category": "Minuman"}
    r = requests.post(f"{API}/products", headers=hdr(owner_token), json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


class TestProducts:
    def test_create(self, created_product):
        assert created_product["name"] == "TEST_Kopi"
        assert created_product["price"] == 5000

    def test_list(self, owner_token, created_product):
        r = requests.get(f"{API}/products", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        ids = [p["id"] for p in r.json()]
        assert created_product["id"] in ids

    def test_update(self, owner_token, created_product):
        payload = {"name": "TEST_Kopi2", "price": 6000, "hpp": 3000, "stock": 20, "unit": "pcs", "low_stock_threshold": 5, "category": "Minuman"}
        r = requests.put(f"{API}/products/{created_product['id']}", headers=hdr(owner_token), json=payload, timeout=30)
        assert r.status_code == 200
        assert r.json()["price"] == 6000


# ---------- Cashiers & Multi-tenant ----------
@pytest.fixture(scope="session")
def cashier_login(owner_token):
    email = f"TEST_cashier_{uuid.uuid4().hex[:8]}@example.com"
    pw = "cashpass1"
    r = requests.post(f"{API}/cashiers", headers=hdr(owner_token),
                      json={"email": email, "password": pw, "name": "Kasir Test"}, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["role"] == "cashier"
    # login as cashier
    r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=30)
    assert r2.status_code == 200
    return {"id": d["id"], "email": email, "token": r2.json()["token"]}


class TestCashiers:
    def test_list_cashiers(self, owner_token, cashier_login):
        r = requests.get(f"{API}/cashiers", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        emails = [c["email"] for c in r.json()]
        assert cashier_login["email"].lower() in emails

    def test_cashier_can_read_products(self, cashier_login):
        r = requests.get(f"{API}/products", headers=hdr(cashier_login["token"]), timeout=30)
        assert r.status_code == 200

    def test_cashier_cannot_create_products(self, cashier_login):
        r = requests.post(f"{API}/products", headers=hdr(cashier_login["token"]),
                          json={"name": "x", "price": 1, "hpp": 0, "stock": 1}, timeout=30)
        assert r.status_code == 403


# ---------- Transactions ----------
class TestTransactions:
    def test_create_txn_decrements_stock_and_profit(self, owner_token, created_product):
        # Get current stock
        r = requests.get(f"{API}/products", headers=hdr(owner_token), timeout=30)
        prod = next(p for p in r.json() if p["id"] == created_product["id"])
        pre_stock = prod["stock"]
        pre_price = prod["price"]
        pre_hpp = prod["hpp"]

        item = {"product_id": created_product["id"], "name": prod["name"], "unit": prod["unit"],
                "qty": 2, "price": pre_price, "subtotal": pre_price * 2}
        txn = {"items": [item], "total": pre_price * 2, "payment_method": "cash",
               "cash_received": pre_price * 2 + 1000, "change": 1000}
        r = requests.post(f"{API}/transactions", headers=hdr(owner_token), json=txn, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        expected_profit = (pre_price - pre_hpp) * 2
        assert abs(d["profit"] - expected_profit) < 0.01
        pytest.txn_id = d["id"]

        # verify stock decremented
        r2 = requests.get(f"{API}/products", headers=hdr(owner_token), timeout=30)
        prod2 = next(p for p in r2.json() if p["id"] == created_product["id"])
        assert prod2["stock"] == pre_stock - 2

    def test_list_txn(self, owner_token):
        r = requests.get(f"{API}/transactions", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        assert any(t["id"] == pytest.txn_id for t in r.json())

    def test_get_txn(self, owner_token):
        r = requests.get(f"{API}/transactions/{pytest.txn_id}", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["id"] == pytest.txn_id


# ---------- Reports ----------
class TestReports:
    def test_summary(self, owner_token):
        r = requests.get(f"{API}/reports/summary", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "today" in d and "week" in d and "series" in d and "low_stock" in d
        assert len(d["series"]) == 7
        assert d["today"]["total"] > 0
        assert d["today"]["count"] >= 1


# ---------- Multi-tenant isolation ----------
class TestMultiTenant:
    def test_other_owner_isolation(self, owner_token):
        # register 2nd owner
        email = f"TEST_owner2_{uuid.uuid4().hex[:8]}@example.com"
        r = requests.post(f"{API}/auth/register",
                          json={"email": email, "password": "pass1234", "name": "Owner2", "shop_name": "S2"}, timeout=30)
        assert r.status_code == 200
        tok2 = r.json()["token"]
        # owner2 products should be empty
        r2 = requests.get(f"{API}/products", headers=hdr(tok2), timeout=30)
        assert r2.status_code == 200
        assert r2.json() == []
        # owner2 transactions empty
        r3 = requests.get(f"{API}/transactions", headers=hdr(tok2), timeout=30)
        assert r3.json() == []


# ---------- File upload ----------
class TestUpload:
    def test_upload_and_download(self, owner_token):
        # 1x1 PNG
        png = bytes.fromhex("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082")
        files = {"file": ("test.png", io.BytesIO(png), "image/png")}
        r = requests.post(f"{API}/upload", headers=hdr(owner_token), files=files, timeout=60)
        assert r.status_code == 200, r.text
        path = r.json()["path"]
        assert path
        # download via query token
        r2 = requests.get(f"{API}/files/{path}?auth={owner_token}", timeout=60)
        assert r2.status_code == 200
        assert r2.content == png


# ---------- Cleanup (product delete) ----------
class TestCleanup:
    def test_delete_product(self, owner_token, created_product):
        r = requests.delete(f"{API}/products/{created_product['id']}", headers=hdr(owner_token), timeout=30)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/products", headers=hdr(owner_token), timeout=30)
        assert created_product["id"] not in [p["id"] for p in r2.json()]

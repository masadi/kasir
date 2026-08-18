import Dexie from "dexie";
import { api } from "@/lib/api";

// Local IndexedDB for offline POS
export const db = new Dexie("kasirku");
db.version(1).stores({
  products: "id, owner_id, name, category",
  pending_txns: "local_id, owner_id, created_at",
  meta: "key",
});

export const isOnline = () => (typeof navigator !== "undefined" ? navigator.onLine : true);

// --- Products cache ---
export async function cacheProducts(ownerId, list) {
  await db.transaction("rw", db.products, async () => {
    await db.products.where("owner_id").equals(ownerId).delete();
    if (list.length) await db.products.bulkPut(list);
  });
}

export async function getCachedProducts(ownerId) {
  return db.products.where("owner_id").equals(ownerId).toArray();
}

export async function updateCachedStock(ownerId, items) {
  await db.transaction("rw", db.products, async () => {
    for (const it of items) {
      const p = await db.products.get(it.product_id);
      if (p && p.owner_id === ownerId) {
        p.stock = Number((p.stock - Number(it.qty)).toFixed(3));
        await db.products.put(p);
      }
    }
  });
}

// --- Pending transactions ---
function localId() {
  return "local-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

export async function queueTxn(ownerId, payload) {
  const rec = {
    local_id: localId(),
    owner_id: ownerId,
    payload,
    created_at: new Date().toISOString(),
    tries: 0,
  };
  await db.pending_txns.put(rec);
  return rec;
}

export async function getPendingCount(ownerId) {
  return db.pending_txns.where("owner_id").equals(ownerId).count();
}

export async function getPending(ownerId) {
  return db.pending_txns.where("owner_id").equals(ownerId).toArray();
}

let syncing = false;
export async function syncPending(ownerId, onProgress) {
  if (syncing || !isOnline()) return { synced: 0, failed: 0 };
  syncing = true;
  let synced = 0, failed = 0;
  try {
    const items = await getPending(ownerId);
    for (const it of items) {
      try {
        await api.post("/transactions", it.payload);
        await db.pending_txns.delete(it.local_id);
        synced++;
      } catch (e) {
        it.tries = (it.tries || 0) + 1;
        it.last_error = String(e?.response?.status || e.message || e);
        await db.pending_txns.put(it);
        failed++;
      }
      if (onProgress) onProgress({ synced, failed });
    }
  } finally {
    syncing = false;
  }
  return { synced, failed };
}

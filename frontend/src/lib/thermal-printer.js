// Web Bluetooth ESC/POS thermal printer (58mm, 32 chars/line)
// Standard printer service UUIDs
const PRINTER_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb",
  "49535343-fe7d-4ae5-8fa9-9fafd205e455",
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
];

const LINE_WIDTH = 32;

let printerDevice = null;
let printerChar = null;

export function isBluetoothSupported() {
  return typeof navigator !== "undefined" && !!navigator.bluetooth;
}

function encoder() {
  return new TextEncoder();
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function bytes(...arr) {
  return new Uint8Array(arr.flat());
}

function textBytes(s) {
  return Array.from(encoder().encode(s));
}

function padLine(left, right, width = LINE_WIDTH) {
  const l = String(left);
  const r = String(right);
  const space = Math.max(1, width - l.length - r.length);
  if (l.length + r.length >= width) {
    return l.slice(0, width - r.length - 1) + " " + r;
  }
  return l + " ".repeat(space) + r;
}

function centerLine(s, width = LINE_WIDTH) {
  const t = String(s).slice(0, width);
  const pad = Math.max(0, Math.floor((width - t.length) / 2));
  return " ".repeat(pad) + t;
}

function separator(ch = "-", width = LINE_WIDTH) {
  return ch.repeat(width);
}

function wordWrap(text, width = LINE_WIDTH) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + (cur ? " " : "") + w).length > width) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + " " + w : w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Build ESC/POS byte stream for receipt
export function buildReceipt({ store, txn, kasirName }) {
  const chunks = [];
  // Init
  chunks.push(bytes(ESC, 0x40));
  // Center + bold + double height for name
  chunks.push(bytes(ESC, 0x61, 0x01)); // center
  chunks.push(bytes(ESC, 0x21, 0x30)); // double h+w
  chunks.push(textBytes(String(store.shop_name || "TOKO").toUpperCase()));
  chunks.push([LF]);
  chunks.push(bytes(ESC, 0x21, 0x00)); // normal
  if (store.address) {
    for (const l of wordWrap(store.address)) {
      chunks.push(textBytes(l));
      chunks.push([LF]);
    }
  }
  chunks.push(bytes(ESC, 0x61, 0x00)); // left
  chunks.push(textBytes(separator()));
  chunks.push([LF]);

  // Items
  for (const it of txn.items) {
    const nameQty = `${it.name} ${it.qty}${it.unit}`;
    const price = "Rp " + Number(it.subtotal).toLocaleString("id-ID");
    if (nameQty.length + price.length + 1 > LINE_WIDTH) {
      chunks.push(textBytes(nameQty.slice(0, LINE_WIDTH)));
      chunks.push([LF]);
      chunks.push(textBytes(padLine("", price)));
      chunks.push([LF]);
    } else {
      chunks.push(textBytes(padLine(nameQty, price)));
      chunks.push([LF]);
    }
  }
  chunks.push(textBytes(separator()));
  chunks.push([LF]);
  chunks.push(bytes(ESC, 0x21, 0x10)); // double height
  chunks.push(textBytes(padLine("TOTAL", "Rp " + Number(txn.total).toLocaleString("id-ID"))));
  chunks.push([LF]);
  chunks.push(bytes(ESC, 0x21, 0x00));

  if (txn.payment_method === "cash") {
    chunks.push(textBytes(padLine("Tunai", "Rp " + Number(txn.cash_received || 0).toLocaleString("id-ID"))));
    chunks.push([LF]);
    chunks.push(textBytes(padLine("Kembali", "Rp " + Number(txn.change || 0).toLocaleString("id-ID"))));
    chunks.push([LF]);
  } else {
    chunks.push(textBytes(padLine("Bayar", "QRIS")));
    chunks.push([LF]);
  }
  chunks.push(textBytes(separator()));
  chunks.push([LF]);
  chunks.push(bytes(ESC, 0x61, 0x01));
  chunks.push(textBytes(store.receipt_footer || "Terima kasih!"));
  chunks.push([LF]);
  const d = new Date(txn.created_at || Date.now());
  const pad = (x) => String(x).padStart(2, "0");
  const ds = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  chunks.push(textBytes(ds));
  chunks.push([LF]);
  chunks.push(textBytes(`Kasir: ${kasirName || "-"}`));
  chunks.push([LF, LF, LF, LF]);
  // Cut (partial)
  chunks.push(bytes(GS, 0x56, 0x01));

  const flat = [];
  for (const c of chunks) {
    for (const b of c) flat.push(b);
  }
  return new Uint8Array(flat);
}

export async function connectPrinter() {
  if (!isBluetoothSupported()) {
    throw new Error("Web Bluetooth tidak didukung. Gunakan Chrome di Android.");
  }
  const device = await navigator.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: PRINTER_SERVICES,
  });
  const server = await device.gatt.connect();
  let char = null;
  const services = await server.getPrimaryServices();
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    for (const c of chars) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        char = c;
        break;
      }
    }
    if (char) break;
  }
  if (!char) throw new Error("Karakteristik printer tidak ditemukan");
  printerDevice = device;
  printerChar = char;
  localStorage.setItem("kasirku_printer_name", device.name || "Printer");
  device.addEventListener("gattserverdisconnected", () => {
    printerDevice = null;
    printerChar = null;
  });
  return device.name || "Printer";
}

export function getPrinterName() {
  return localStorage.getItem("kasirku_printer_name") || null;
}

export function isPrinterConnected() {
  return !!(printerDevice && printerDevice.gatt.connected);
}

export async function ensureConnected() {
  if (isPrinterConnected() && printerChar) return;
  if (printerDevice && !printerDevice.gatt.connected) {
    await printerDevice.gatt.connect();
    return;
  }
  await connectPrinter();
}

export async function printBytes(data) {
  await ensureConnected();
  // Chunk to 180 bytes for reliability
  const chunkSize = 180;
  for (let i = 0; i < data.length; i += chunkSize) {
    const slice = data.slice(i, i + chunkSize);
    if (printerChar.properties.writeWithoutResponse) {
      await printerChar.writeValueWithoutResponse(slice);
    } else {
      await printerChar.writeValue(slice);
    }
  }
}

export async function printReceipt(payload) {
  const data = buildReceipt(payload);
  await printBytes(data);
}

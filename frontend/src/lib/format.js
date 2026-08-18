export const rupiah = (n) => {
  const v = Number(n || 0);
  return "Rp " + v.toLocaleString("id-ID", { maximumFractionDigits: 0 });
};

export const formatQty = (q, unit) => {
  const n = Number(q || 0);
  if (unit === "kg" || unit === "ons") return `${n} ${unit}`;
  return `${Math.round(n)} ${unit}`;
};

export const formatDateTime = (iso) => {
  const d = new Date(iso);
  const pad = (x) => String(x).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

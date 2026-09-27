import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import "./styles.css";

const peso = n => `₱${Number(n || 0).toFixed(2)}`;
const qtyText = item => item.unit === "kg"
  ? `${Number(item.quantity).toFixed(3)} kg`
  : `${Number(item.quantity)} pc`;

async function api(url, options = {}, adminToken = "", cashierToken = "") {
  const headers = { ...(options.headers || {}) };
  if (adminToken) headers["x-admin-token"] = adminToken;
  if (cashierToken) headers["x-cashier-token"] = cashierToken;
  if (options.body !== undefined && options.body !== null) headers["Content-Type"] = "application/json";
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

const POS_SOUND_KEY = "pos-sound-enabled";

function isPosSoundEnabled() {
  return localStorage.getItem(POS_SOUND_KEY) !== "0";
}

function playPosSound(type = "click") {
  if (!isPosSoundEnabled()) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;
    const presets = {
      click: [{ f: 680, d: 0.045, g: 0.045 }],
      scan: [{ f: 980, d: 0.07, g: 0.06 }],
      success: [{ f: 660, d: 0.07, g: 0.06 }, { f: 880, d: 0.09, g: 0.06, t: 0.07 }],
      error: [{ f: 220, d: 0.11, g: 0.07 }, { f: 160, d: 0.13, g: 0.06, t: 0.08 }]
    };
    (presets[type] || presets.click).forEach(({ f, d, g, t = 0 }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type === "error" ? "square" : "sine";
      osc.frequency.setValueAtTime(f, now + t);
      gain.gain.setValueAtTime(0.0001, now + t);
      gain.gain.exponentialRampToValueAtTime(g, now + t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + d);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + t);
      osc.stop(now + t + d + 0.02);
    });
    window.setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch (_) {}
}

const EMOJI_GROUPS = {
  "Popular": "🛒 🛍️ ⭐ ❤️ 👍 🔥 ✨ 🎁",
  "Fruits": "🍎 🍏 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝",
  "Vegetables": "🥬 🥦 🥒 🌶️ 🫑 🌽 🥕 🧄 🧅 🥔 🍠 🍆 🍅 🫛 🥑 🥗",
  "Meat & Eggs": "🥩 🍗 🍖 🥓 🌭 🍔 🥚 🥚",
  "Bakery": "🍞 🥐 🥖 🥨 🧇 🥞 🧁 🍰 🎂 🍪 🍩",
  "Drinks": "🥛 ☕ 🍵 🧃 🧋 🥤 🧊 🍶 🍺 🍷",
  "Pantry": "🍚 🍜 🍝 🥫 🧂 🧈 🍯 🥜 🌰 🍿 🍫 🍬 🍭",
  "Household": "🧼 🫧 🧽 🧴 🪥 🧹 🧺 🧻 🧯 💡 🔋"
};
const EMOJI_LIST = Object.fromEntries(Object.entries(EMOJI_GROUPS).map(([name, value]) => [name, value.split(" ").filter(Boolean)]));

function EmojiPicker({ value, onChange, onClose }) {
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("Popular");
  const ref = useRef(null);
  const groups = Object.keys(EMOJI_LIST);
  const visible = useMemo(() => {
    if (!query.trim()) return EMOJI_LIST[group] || [];
    const q = query.trim().toLowerCase();
    const all = groups.flatMap(g => EMOJI_LIST[g].map(emoji => ({ emoji, group: g })));
    return all.filter(x => x.group.toLowerCase().includes(q) || emojiName(x.emoji).includes(q)).map(x => x.emoji);
  }, [query, group]);
  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) onClose?.(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);
  return <div className="emoji-picker" ref={ref}>
    <div className="emoji-picker-search"><span>⌕</span><input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search emoji..." /></div>
    {!query.trim() && <div className="emoji-picker-tabs">{groups.map(g => <button type="button" key={g} className={group === g ? "active" : ""} onClick={() => setGroup(g)}>{g}</button>)}</div>}
    <div className="emoji-grid">{visible.map((emoji, i) => <button type="button" key={`${emoji}-${i}`} className={value === emoji ? "selected" : ""} onClick={() => { onChange(emoji); onClose?.(); }}>{emoji}</button>)}{!visible.length && <div className="emoji-empty">No matching emoji.</div>}</div>
  </div>;
}

function emojiName(emoji) {
  const names = { "🥕":"carrot", "🥬":"leafy greens", "🥦":"broccoli", "🍎":"apple", "🍌":"banana", "🍊":"orange", "🍋":"lemon", "🍇":"grapes", "🍓":"strawberry", "🧄":"garlic", "🧅":"onion", "🥔":"potato", "🍅":"tomato", "🌽":"corn", "🥚":"egg", "🍚":"rice", "🍞":"bread", "🥛":"milk", "🧃":"juice", "🥤":"drink", "🧼":"soap", "🧴":"lotion", "🧽":"sponge", "🧻":"toilet paper", "☕":"coffee", "🍫":"chocolate", "🍪":"cookie", "🍯":"honey", "🥜":"peanut", "🥩":"beef", "🍗":"chicken", "🥓":"bacon" };
  return names[emoji] || emoji;
}

function NumericField({ value, onChange, placeholder = "0", prefix, className = "", allowDecimal = true, onEnter, autoFocus = false, mask = false, defaultOpen = false }) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const wrapRef = useRef(null);
  const [keypadStyle, setKeypadStyle] = useState({});

  const updateKeypadPosition = () => {
    if (!wrapRef.current) return;
    const anchor = wrapRef.current;
    const modal = anchor.closest(".modal");
    const width = Math.min(320, Math.max(280, window.innerWidth - 24));
    const height = window.innerWidth <= 560 ? 420 : 430;
    const gap = 14;
    const pad = 12;
    let left = 0;
    let top = 0;

    if (modal) {
      const rect = modal.getBoundingClientRect();
      const rightFits = rect.right + gap + width <= window.innerWidth - pad;
      const leftFits = rect.left - gap - width >= pad;
      if (rightFits) {
        left = rect.right + gap;
        top = Math.max(pad, Math.min(rect.top, window.innerHeight - height - pad));
      } else if (leftFits) {
        left = rect.left - gap - width;
        top = Math.max(pad, Math.min(rect.top, window.innerHeight - height - pad));
      } else {
        // If there is not enough room beside the modal, keep the keypad out of
        // the modal content by docking it to the nearest screen edge.
        left = Math.max(pad, Math.min(window.innerWidth - width - pad, rect.right + gap));
        if (left + width > window.innerWidth - pad) left = pad;
        top = rect.bottom + gap;
        if (top + height > window.innerHeight - pad) top = rect.top - height - gap;
        top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
      }
    } else {
      const rect = anchor.getBoundingClientRect();
      left = rect.right + gap;
      if (left + width > window.innerWidth - pad) left = rect.left - width - gap;
      left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
      top = Math.max(pad, Math.min(rect.top, window.innerHeight - height - pad));
    }

    setKeypadStyle({ left, top, width });
  };

  const openKeypad = () => {
    window.dispatchEvent(new CustomEvent("pos:numeric-open"));
    setOpen(true);
    requestAnimationFrame(() => requestAnimationFrame(updateKeypadPosition));
  };

  useEffect(() => {
    if (!(autoFocus || defaultOpen)) return;
    const timer = window.setTimeout(() => openKeypad(), 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus, defaultOpen]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("numeric-keypad-open");
    const closeOthers = () => setOpen(false);
    window.addEventListener("pos:numeric-open", closeOthers);
    const refresh = () => updateKeypadPosition();
    const onEscape = e => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("keydown", onEscape);
    refresh();
    return () => {
      document.body.classList.remove("numeric-keypad-open");
      window.removeEventListener("pos:numeric-open", closeOthers);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const handleKeyDown = e => {
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); let next = String(value ?? ""); onChange(next === "0" ? e.key : next + e.key); return; }
    if (e.key === "." && allowDecimal) { e.preventDefault(); if (!String(value ?? "").includes(".")) onChange(String(value ?? "") || "0."); return; }
    if (e.key === "Backspace") { e.preventDefault(); onChange(String(value ?? "").slice(0, -1)); return; }
    if (e.key === "Enter") { e.preventDefault(); setOpen(false); onEnter?.(); return; }
  };

  const keypad = open ? createPortal(
    <div className="numeric-keypad numeric-keypad-docked" style={keypadStyle} onMouseDown={e => e.preventDefault()}>
      <div className="keypad-grid">
        { ["1","2","3","4","5","6","7","8","9"].map(k => <button type="button" key={k} onClick={() => { let next = String(value ?? ""); onChange(next === "0" ? k : next + k); }}>{k}</button>) }
        <button type="button" className="keypad-clear" onClick={() => onChange("")}>C</button>
        <button type="button" onClick={() => { let next = String(value ?? ""); onChange(next === "0" ? "0" : next + "0"); }}>0</button>
        {allowDecimal ? <button type="button" className="keypad-muted" onClick={() => { let next = String(value ?? ""); if (!next.includes(".")) onChange(next ? next + "." : "0."); }}>.</button> : <button type="button" className="keypad-backspace" onClick={() => onChange(String(value ?? "").slice(0, -1))}>⌫</button>}
        {allowDecimal && <button type="button" className="keypad-backspace" onClick={() => onChange(String(value ?? "").slice(0, -1))}>⌫</button>}
        <button type="button" className="keypad-enter" onClick={() => { setOpen(false); onEnter?.(); }}>Done</button>
      </div>
    </div>,
    document.body
  ) : null;

  return <div className={`numeric-field ${className}`} ref={wrapRef}>
    <div className={`numeric-input-wrap ${open || focused ? "focused" : ""}`}>
      {prefix && <span>{prefix}</span>}
      <input
        autoFocus={autoFocus}
        className="numeric-input"
        type="text"
        inputMode="none"
        readOnly
        value={mask && value ? "•".repeat(String(value).length) : (value ?? "")}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => {}}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
      />
      <button type="button" className="keypad-toggle" onMouseDown={e => e.preventDefault()} onClick={() => { if (open) setOpen(false); else openKeypad(); }} aria-label="Toggle number pad">⌨</button>
    </div>
    {keypad}
  </div>;
}

async function compressImage(file) {
  if (!file) return "";
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image file.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.78);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProductVisual({ product, className = "" }) {
  return product.imageData
    ? <img className={className} src={product.imageData} alt="" />
    : <span className={className}>{product.emoji || "🛒"}</span>;
}

function BrandLogo({ storeInfo, className = "" }) {
  return storeInfo?.logoData
    ? <img className={`brand-logo-image ${className}`} src={storeInfo.logoData} alt="" />
    : <span className={`brand-logo-fallback ${className}`}>✦</span>;
}

const DEFAULT_RECEIPT_SETTINGS = { showLogo:true, showStoreName:true, showTagline:true, showAddress:true, showContact:true, showTransactionNumber:true, showDatetime:true, showPaymentMethod:true, logoSize:'medium', layout:'standard', footerMessage:'Thank you for shopping with us!', refundMessage:'Please keep this receipt for your records.' };

function receiptQty(item) { return item.unit === 'kg' ? `${Number(item.quantity).toFixed(3)} kg` : `${Number(item.quantity)} pc`; }

// SQLite may return receipt toggle values as 0/1 numbers, while older or imported
// databases can contain the same values as strings. Normalize them before rendering
// so a stored 0/'0' always means OFF.
function receiptToggle(value) {
  return value === true || value === 1 || value === '1' || (typeof value === 'string' && value.toLowerCase() === 'true');
}

function ReceiptView({ sale, storeInfo, receiptSettings, preview=false }) {
  const r = { ...DEFAULT_RECEIPT_SETTINGS, ...(receiptSettings || {}) };
  const isRefunded = sale?.refundStatus === 'full' || sale?.refundedAt;
  const items = sale?.items || [];
  const refundedAmount = Number(sale?.refundedAmount || 0);
  const remainingTotal = Math.max(0, Number(sale?.total || 0) - refundedAmount);
  const logoClass = r.logoSize === 'small' ? 'receipt-logo-small' : r.logoSize === 'large' ? 'receipt-logo-large' : 'receipt-logo-medium';
  return <div className={`receipt-paper ${r.layout === 'compact' ? 'receipt-compact' : ''} ${preview ? 'receipt-preview-paper' : ''}`}>
    {receiptToggle(r.showLogo) && (storeInfo?.logoData ? <img className={`receipt-logo ${logoClass}`} src={storeInfo.logoData} alt="" /> : <div className={`receipt-fallback ${logoClass}`}>✦</div>)}
    {receiptToggle(r.showStoreName) && <h2>{storeInfo?.storeName || 'Grocery POS'}</h2>}
    {receiptToggle(r.showTagline) && storeInfo?.tagline && <p className="receipt-muted">{storeInfo.tagline}</p>}
    {receiptToggle(r.showAddress) && storeInfo?.address && <p>{storeInfo.address}</p>}
    {receiptToggle(r.showContact) && storeInfo?.contact && <p>{storeInfo.contact}</p>}
    <div className="receipt-rule" />
    {!preview && <div className="receipt-label">{isRefunded ? 'REFUNDED RECEIPT' : sale?.refundStatus === 'partial' ? 'PARTIALLY REFUNDED' : 'DIGITAL RECEIPT'}</div>}
    {receiptToggle(r.showTransactionNumber) && <div className="receipt-meta"><span>Transaction</span><strong>{sale?.transactionNumber || 'TX-000000'}</strong></div>}
    {receiptToggle(r.showDatetime) && <div className="receipt-meta"><span>Date &amp; Time</span><strong>{sale?.createdAt ? new Date(String(sale.createdAt).replace(' ','T')).toLocaleString() : new Date().toLocaleString()}</strong></div>}
    <div className="receipt-rule" />
    <div className="receipt-items">{items.map((i,idx)=>{const netLine=Math.max(0,Number(i.total||0)-Number(i.refundedTotal||0)); return <div className="receipt-row-item" key={i.id || idx}><div><strong>{i.name}</strong><small>{i.priceType} · {receiptQty(i)} · {peso(i.unitPrice)}/{i.unit}</small></div><strong>{peso(netLine)}</strong></div>})}</div>
    <div className="receipt-rule" />
    <div className="receipt-meta"><span>Subtotal</span><strong>{peso(sale?.subtotal)}</strong></div>
    {Number(sale?.discount || 0) > 0 && <div className="receipt-meta"><span>Discount</span><strong>− {peso(sale.discount)}</strong></div>}
    {refundedAmount > 0 && <div className="receipt-meta"><span>Refunded</span><strong>− {peso(refundedAmount)}</strong></div>}
    <div className="receipt-grand"><span>Total</span><strong>{peso(remainingTotal)}</strong></div>
    {receiptToggle(r.showPaymentMethod) && <div className="receipt-meta"><span>Payment</span><strong>Cash</strong></div>}
    {!preview && <><div className="receipt-meta"><span>Cash Received</span><strong>{peso(sale?.cashReceived)}</strong></div><div className="receipt-meta"><span>Change</span><strong>{peso(sale?.changeAmount)}</strong></div></>}
    {r.refundMessage && <p className="receipt-footer-note">{r.refundMessage}</p>}
    {r.footerMessage && <p className="receipt-footer-message">{r.footerMessage}</p>}
  </div>;
}

function printDigitalReceipt(sale, storeInfo, receiptSettings) {
  if (!sale) return;
  const w = window.open('', '_blank', 'width=520,height=800');
  if (!w) { alert('Please allow pop-ups to print the receipt.'); return; }
  const r = { ...DEFAULT_RECEIPT_SETTINGS, ...(receiptSettings || {}) };
  const esc = v => String(v ?? '').replace(/[&<>\"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]));
  const money = v => `₱${Number(v || 0).toFixed(2)}`;
  const qty = i => i.unit === 'kg' ? `${Number(i.quantity).toFixed(3)} kg` : `${Number(i.quantity)} pc`;
  const items = (sale.items || []).map(i => `<div class="item"><div><b>${esc(i.name)}</b><small>${esc(i.priceType)} · ${esc(qty(i))} · ${money(i.unitPrice)}/${esc(i.unit)}</small></div><b>${money(Math.max(0,Number(i.total||0)-Number(i.refundedTotal||0)))}</b></div>`).join('');
  const logo = receiptToggle(r.showLogo) ? (storeInfo?.logoData ? `<img class="logo ${r.logoSize}" src="${storeInfo.logoData}" alt="">` : `<div class="fallback ${r.logoSize}">✦</div>`) : '';
  const info = `${receiptToggle(r.showStoreName) ? `<h1>${esc(storeInfo?.storeName || 'Grocery POS')}</h1>` : ''}${receiptToggle(r.showTagline) && storeInfo?.tagline ? `<p>${esc(storeInfo.tagline)}</p>` : ''}${receiptToggle(r.showAddress) && storeInfo?.address ? `<p>${esc(storeInfo.address)}</p>` : ''}${receiptToggle(r.showContact) && storeInfo?.contact ? `<p>${esc(storeInfo.contact)}</p>` : ''}`;
  const meta = `${receiptToggle(r.showTransactionNumber) ? `<div><span>Transaction</span><b>${esc(sale.transactionNumber)}</b></div>` : ''}${receiptToggle(r.showDatetime) ? `<div><span>Date & Time</span><b>${esc(sale.createdAt ? new Date(String(sale.createdAt).replace(' ','T')).toLocaleString() : '')}</b></div>` : ''}`;
  const refund = Number(sale.refundedAmount || 0); const total = Math.max(0,Number(sale.total||0)-refund);
  w.document.write(`<!doctype html><html><head><title>${esc(sale.transactionNumber)} Receipt</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#202a24;font-size:11px;width:72mm;margin:0 auto;text-align:center}.logo,.fallback{display:block;width:64px;height:64px;object-fit:contain;margin:0 auto 8px}.logo.small,.fallback.small{width:46px;height:46px}.logo.large,.fallback.large{width:82px;height:82px}.fallback{display:grid;place-items:center;background:#16804f;color:#fff;border-radius:14px;font-size:28px}h1{font-size:18px;margin:0 0 3px}p{margin:3px 0;color:#66736b;font-size:10px}.rule{border-top:1px dashed #aab7ae;margin:10px 0}.meta,.item{display:flex;justify-content:space-between;gap:8px;text-align:left;margin:5px 0}.meta span,small{color:#6d7972;font-size:9px}.item{padding:5px 0}.item small{display:block;margin-top:2px}.total{display:flex;justify-content:space-between;font-size:14px;font-weight:800;margin:8px 0}.note{font-size:9px;color:#68756e;margin-top:12px}.footer{font-size:10px;font-weight:700;margin-top:8px}.compact .item{padding:3px 0}.compact .rule{margin:7px 0}</style></head><body class="${r.layout === 'compact' ? 'compact' : ''}">${logo}${info}<div class="rule"></div>${meta}<div class="rule"></div>${items}<div class="rule"></div><div class="meta"><span>Subtotal</span><b>${money(sale.subtotal)}</b></div>${Number(sale.discount||0)>0?`<div class="meta"><span>Discount</span><b>− ${money(sale.discount)}</b></div>`:''}${refund>0?`<div class="meta"><span>Refunded</span><b>− ${money(refund)}</b></div>`:''}<div class="total"><span>Total</span><b>${money(total)}</b></div>${r.showPaymentMethod?'<div class="meta"><span>Payment</span><b>Cash</b></div>':''}<div class="meta"><span>Cash Received</span><b>${money(sale.cashReceived)}</b></div><div class="meta"><span>Change</span><b>${money(sale.changeAmount)}</b></div>${r.refundMessage?`<p class="note">${esc(r.refundMessage)}</p>`:''}${r.footerMessage?`<p class="footer">${esc(r.footerMessage)}</p>`:''}<script>window.onload=()=>setTimeout(()=>window.print(),250);</script></body></html>`);
  w.document.close();
}

function ProductModal({ product, onClose, onAdd }) {
  const [priceType, setPriceType] = useState("retail");
  const [mode, setMode] = useState(product.unit === "kg" ? "weight" : "quantity");
  const [value, setValue] = useState("");
  const price = Number(product[priceType]);
  const numeric = Number(value) || 0;
  const calculatedQty = product.unit === "kg" && mode === "amount" ? numeric / price : numeric;
  const total = product.unit === "kg" && mode === "amount" ? numeric : numeric * price;
  const [valueError, setValueError] = useState("");
  const submit = () => {
    if (numeric <= 0 || !Number.isFinite(total)) { setValueError("Enter a value greater than 0."); return; }
    setValueError("");
    onAdd({ productId: product.id, name: product.name, emoji: product.emoji, imageData: product.imageData, unit: product.unit, priceType, unitPrice: price, quantity: calculatedQty, total });
    onClose();
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <div className="modal pop-in" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div className="modal-product-title"><div className="modal-product-visual"><ProductVisual product={product} /></div><div><h2>{product.name}</h2><p>{product.unit === "kg" ? "Sold by kilogram" : "Sold by piece"}</p></div></div><button className="icon-btn" onClick={onClose}>×</button></div>
      <label className="label">Price Type</label>
      <div className="segmented"><button className={priceType === "retail" ? "active" : ""} onClick={() => setPriceType("retail")}>Retail <small>{peso(product.retail)}/{product.unit}</small></button><button className={priceType === "wholesale" ? "active" : ""} onClick={() => setPriceType("wholesale")}>Wholesale <small>{peso(product.wholesale)}/{product.unit}</small></button></div>
      {product.unit === "kg" && <><label className="label">Enter By</label><div className="segmented"><button className={mode === "weight" ? "active" : ""} onClick={() => { setMode("weight"); setValue(""); }}>Weight <small>How many kg?</small></button><button className={mode === "amount" ? "active" : ""} onClick={() => { setMode("amount"); setValue(""); }}>Amount <small>How many pesos?</small></button></div></>}
      <label className="label">{product.unit === "piece" ? "Quantity (pieces)" : mode === "weight" ? "Weight (kg)" : "Amount (₱)"}</label>
      <NumericField value={value} onChange={v => { setValue(v); if (v) setValueError(""); }} placeholder="0" allowDecimal={product.unit === "kg"} autoFocus onEnter={submit} className={`big-numeric ${valueError ? "field-invalid" : ""}`} />
      {valueError && <div className="field-error">{valueError}</div>}
      <div className="calculation">{product.unit === "kg" && mode === "amount" && <div>Calculated weight <strong>{calculatedQty.toFixed(3)} kg</strong></div>}<div>Unit price <strong>{peso(price)} / {product.unit}</strong></div><div className="calc-total">Total <strong>{peso(total)}</strong></div></div>
      <button className="primary wide" disabled={!numeric} onClick={submit}>ADD TO CART <span>→</span></button>
    </div>
  </div>;
}

function Success({ sale, onNew, onHome, storeInfo, receiptSettings }) {
  const [showReceipt, setShowReceipt] = useState(true);
  return <main className="success-page">
    <div className="success-card pop-in">
      <div className="success-icon">✓</div>
      <h1>Sale Complete!</h1>
      <p>{sale.transactionNumber} · Transaction recorded</p>
      <div className="success-total">{peso(sale.total)}</div>
      <div className="success-detail"><span>Cash received</span><strong>{peso(sale.cashReceived)}</strong></div>
      <div className="success-detail"><span>Change</span><strong>{peso(sale.changeAmount)}</strong></div>
      <div className="success-receipt-actions"><button className="secondary" onClick={()=>setShowReceipt(v=>!v)}>{showReceipt?'Hide Receipt':'View Receipt'}</button><button className="secondary" onClick={()=>printDigitalReceipt(sale,storeInfo,receiptSettings)}>⎙ Print Receipt</button></div>
      {showReceipt && <ReceiptView sale={sale} storeInfo={storeInfo} receiptSettings={receiptSettings} />}
      <button className="primary wide" onClick={onNew}>＋ New Transaction</button>
      <button className="secondary wide" onClick={onHome}><span className="back-arrow">←</span><span>Home</span></button>
    </div>
  </main>;
}

function BarcodeScannerModal({ products, onClose, onAdd }) {
  const [barcode, setBarcode] = useState("");
  const [priceType, setPriceType] = useState("retail");
  const [quantity, setQuantity] = useState("1");
  const [scanCart, setScanCart] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    focus();
    const timer = window.setTimeout(focus, 80);
    return () => window.clearTimeout(timer);
  }, []);

  const findProduct = async code => {
    const value = String(code || "").trim();
    if (!value) return null;
    const local = products.find(p => !p.isDeleted && p.isAvailable && String(p.barcode || "") === value);
    if (local) return local;
    try { return await api(`/api/products/barcode/${encodeURIComponent(value)}`); } catch (e) { throw e; }
  };

  const scan = async e => {
    e?.preventDefault?.();
    const code = barcode.trim();
    if (!code) { setError("Enter or scan a barcode first."); return; }
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) { setError("Enter a quantity greater than 0."); return; }
    setError(""); setMessage("");
    try {
      const product = await findProduct(code);
      if (!product) throw new Error(`Barcode ${code} was not found.`);
      const unitPrice = Number(product[priceType]);
      const total = qty * unitPrice;
      setScanCart(prev => {
        const existing = prev.find(x => x.productId === product.id && x.priceType === priceType);
        if (existing) return prev.map(x => x === existing ? { ...x, quantity: x.quantity + qty, total: (x.quantity + qty) * x.unitPrice } : x);
        return [...prev, { productId: product.id, name: product.name, emoji: product.emoji, imageData: product.imageData, unit: product.unit, priceType, unitPrice, quantity: qty, total, barcode: product.barcode }];
      });
      playPosSound("scan");
      setMessage(`${product.name} added.`);
      setBarcode("");
      setQuantity("1");
      window.setTimeout(() => inputRef.current?.focus(), 30);
    } catch (err) {
      playPosSound("error");
      setError(err.message || "Barcode not found.");
      setBarcode("");
      setQuantity("1");
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const updateQty = (index, delta) => setScanCart(prev => prev.map((item, i) => i === index ? { ...item, quantity: Math.max(0, item.quantity + delta), total: Math.max(0, item.quantity + delta) * item.unitPrice } : item).filter(item => item.quantity > 0));
  const total = scanCart.reduce((sum, item) => sum + item.total, 0);
  const addAll = () => { if (!scanCart.length) return; onAdd(scanCart); onClose(); };

  return createPortal(<div className="modal-backdrop scanner-backdrop" onMouseDown={onClose}>
    <form className="modal pop-in scanner-modal" onSubmit={scan} onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">BARCODE SCANNER</div><h2>Scan Product</h2><p>Use a scanner or enter the barcode manually.</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
      <div className="scanner-mode-note"><strong>How it works:</strong> Scan a barcode and press Enter. A USB scanner will normally type the code here and send Enter automatically.</div>
      <div className="scanner-layout">
        <section className="scanner-entry-pane">
          <label className="label">Barcode</label>
          <input ref={inputRef} className={`text-input scanner-barcode-input ${error ? "field-invalid" : ""}`} value={barcode} onChange={e => { setBarcode(e.target.value); setError(""); setMessage(""); }} onKeyDown={e => { if (e.key === "Enter") scan(e); }} placeholder="Enter barcode..." autoComplete="off"  />
          <div className="scanner-controls"><div><label className="label">Price Type</label><div className="segmented"><button type="button" className={priceType === "retail" ? "active" : ""} onClick={() => setPriceType("retail")}>Retail</button><button type="button" className={priceType === "wholesale" ? "active" : ""} onClick={() => setPriceType("wholesale")}>Wholesale</button></div></div><div><label className="label">Quantity</label><NumericField value={quantity} onChange={v => setQuantity(v)} placeholder="1" allowDecimal={false} /></div></div>
          <button type="submit" className="primary wide scanner-add-button">SCAN / ADD <span>↵</span></button>
          {error && <div className="field-error scanner-message">{error}</div>}
          {message && !error && <div className="scanner-success">✓ {message}</div>}
        </section>
        <section className="scanner-cart-pane">
          <div className="scanner-cart-head"><div><strong>Scanned Items</strong><small>{scanCart.length} line{scanCart.length !== 1 ? "s" : ""}</small></div><strong>{peso(total)}</strong></div>
          <div className="scanner-cart">{!scanCart.length ? <div className="scanner-empty"><span>▣</span><div><strong>No scanned products yet</strong><small>Scan or enter a barcode to add an item.</small></div></div> : scanCart.map((item, index) => <div className="scanner-cart-item" key={`${item.productId}-${item.priceType}`}><div className="scanner-cart-main"><div className="scanner-cart-visual">{item.imageData ? <img src={item.imageData} alt="" /> : <span>{item.emoji || "🛒"}</span>}</div><div><strong>{item.name}</strong><small>{item.priceType} · {peso(item.unitPrice)}/{item.unit} · {item.barcode || "No barcode"}</small></div></div><div className="scanner-cart-actions"><button type="button" onClick={() => updateQty(index, -1)}>−</button><b>{item.quantity}</b><button type="button" onClick={() => updateQty(index, 1)}>+</button><button type="button" className="remove" onClick={() => updateQty(index, -item.quantity)}>×</button></div></div>)}</div>
          <div className="form-actions scanner-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancel</button><button type="button" className="primary" disabled={!scanCart.length} onClick={addAll}>Add to Cart ({scanCart.length})</button></div>
        </section>
      </div>
    </form>
  </div>, document.body);
}

function ConfirmModal({ title, message, confirmLabel = "Delete", busyLabel = "Processing...", onConfirm, onCancel, busy = false }) {
  return <div className="modal-backdrop confirm-backdrop" onMouseDown={onCancel}>
    <div className="modal pop-in confirm-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="confirm-icon">!</div>
      <div className="confirm-copy">
        <h2>{title}</h2>
        <p>{message}</p>
      </div>
      <div className="form-actions confirm-actions">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="danger" onClick={onConfirm} disabled={busy}>{busy ? busyLabel : confirmLabel}</button>
      </div>
    </div>
  </div>;
}

function AdminAuthModal({ configured, onClose, onSuccess }) {
  const [mode, setMode] = useState(configured ? "login" : "setup");
  const [passcode, setPasscode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryConfirm, setRecoveryConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generatedRecovery, setGeneratedRecovery] = useState("");
  const [generatedToken, setGeneratedToken] = useState("");
  const [savedRecovery, setSavedRecovery] = useState(false);
  const setup = mode === "setup";
  const recovery = mode === "recovery";

  const submit = async () => {
    setError("");
    if (recovery) {
      const normalized = recoveryCode.replace(/[^a-z0-9]/gi, "").toUpperCase();
      if (!/^[A-F0-9]{32}$/.test(normalized)) { setError("Enter the complete recovery code."); return; }
      if (!/^\d{4,12}$/.test(passcode)) { setError("New passcode must contain 4 to 12 digits."); return; }
      if (passcode !== recoveryConfirm) { setError("The passcodes do not match."); return; }
    } else {
      if (!/^\d{4,12}$/.test(passcode)) { setError(setup ? "Use 4 to 12 digits." : "Enter your 4 to 12 digit passcode."); return; }
      if (setup && passcode !== confirm) { setError("The passcodes do not match."); return; }
    }
    setBusy(true);
    try {
      if (recovery) {
        const result = await api("/api/auth/recover", { method:"POST", body:JSON.stringify({ recoveryCode, newPasscode:passcode }) });
        onSuccess(result.token, false);
      } else {
        const result = await api(setup ? "/api/auth/setup" : "/api/auth/login", { method:"POST", body:JSON.stringify({ passcode }) });
        if (setup && result.recoveryCode) {
          setGeneratedRecovery(result.recoveryCode);
          setGeneratedToken(result.token);
          setSavedRecovery(false);
        } else {
          onSuccess(result.token, setup);
        }
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (generatedRecovery) return createPortal(<div className="modal-backdrop auth-backdrop" onMouseDown={e => { if (savedRecovery) onClose(); }}>
    <div className="modal pop-in auth-modal recovery-created" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">SAVE THIS NOW</div><h2>Recovery Code</h2><p>This code is your backup if you forget the admin passcode.</p></div><button type="button" className="icon-btn" onClick={() => savedRecovery && onClose()} disabled={!savedRecovery}>×</button></div>
      <div className="recovery-code-box"><strong>{generatedRecovery}</strong><button type="button" className="secondary small-btn" onClick={() => navigator.clipboard?.writeText(generatedRecovery)}>Copy</button></div>
      <div className="auth-warning">This code is shown only once. Store it somewhere safe. It can reset the admin passcode.</div>
      <label className="check-row"><input type="checkbox" checked={savedRecovery} onChange={e => setSavedRecovery(e.target.checked)} /><span>I have saved my recovery code.</span></label>
      <div className="form-actions"><button type="button" className="primary wide" disabled={!savedRecovery} onClick={() => onSuccess(generatedToken, true)}>Continue to POS</button></div>
    </div>
  </div>, document.body);

  return createPortal(<div className="modal-backdrop auth-backdrop" onMouseDown={onClose}>
    <div className="modal pop-in auth-modal auth-modal-compact" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">OWNER / ADMIN</div><h2>{recovery ? "Recover Admin Access" : setup ? "Create Admin Passcode" : "Admin Authorization"}</h2><p>{recovery ? "Use your recovery code to create a new passcode." : setup ? "Set the passcode required for owner-only features." : "Enter the admin passcode to continue."}</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
      {recovery ? <>
        <label className="label">Recovery Code</label>
        <input className={`text-input recovery-input ${error ? "field-invalid" : ""}`} value={recoveryCode} onChange={e => { setRecoveryCode(e.target.value.toUpperCase()); setError(""); }} placeholder="XXXX-XXXX-XXXX-XXXX..." autoFocus />
        <label className="label">New Passcode</label>
        <NumericField value={passcode} onChange={v => { setPasscode(v.replace(/\D/g, "").slice(0,12)); setError(""); }} placeholder="••••" allowDecimal={false} mask className="auth-numeric" />
        <label className="label">Confirm New Passcode</label>
        <NumericField value={recoveryConfirm} onChange={v => { setRecoveryConfirm(v.replace(/\D/g, "").slice(0,12)); setError(""); }} placeholder="••••" allowDecimal={false} mask className="auth-numeric" onEnter={submit} />
      </> : <>
        <label className="label">{setup ? "New Passcode" : "Admin Passcode"}</label>
        <NumericField value={passcode} onChange={v => { setPasscode(v.replace(/\D/g, "").slice(0,12)); setError(""); }} placeholder="••••" allowDecimal={false} mask className="auth-numeric" onEnter={() => { if (setup && !confirm) return; submit(); }} autoFocus defaultOpen />
        {setup && <><label className="label">Confirm Passcode</label><NumericField value={confirm} onChange={v => { setConfirm(v.replace(/\D/g, "").slice(0,12)); setError(""); }} placeholder="••••" allowDecimal={false} mask className="auth-numeric" onEnter={submit} /></>}
      </>}
      {error && <div className="field-error auth-error">{error}</div>}
      {!recovery && <div className="auth-note">Your passcode is stored as a secure hash in the local SQLite database.</div>}
      {recovery ? <div className="auth-help">Recovery codes are one-time use. After a successful reset, generate a new one in Owner / Admin Settings.</div> : !setup && <button type="button" className="text-link" onClick={() => { setMode("recovery"); setError(""); setPasscode(""); setConfirm(""); }}>Forgot passcode?</button>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" onClick={submit} disabled={busy}>{busy ? recovery ? "Recovering..." : setup ? "Creating..." : "Checking..." : recovery ? "Reset Passcode" : setup ? "Create Passcode" : "Unlock"}</button></div>
    </div>
  </div>, document.body);
}


function CashierLoginModal({ onClose, onSuccess }) {
  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!username.trim() || !/^\d{4,12}$/.test(pin)) { setError("Enter your username and 4 to 12 digit PIN."); return; }
    setBusy(true); setError("");
    try { const result = await api("/api/cashier/login", { method:"POST", body:JSON.stringify({ username, pin }) }); onSuccess(result.token, result.cashier); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="modal-backdrop auth-backdrop" onMouseDown={onClose}>
    <div className="modal pop-in auth-modal auth-modal-compact" onMouseDown={e=>e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">CASHIER</div><h2>Cashier Login</h2><p>Sign in with your cashier account to record sales under your name.</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
      <label className="label">Username</label><input className="text-input" value={username} onChange={e=>{setUsername(e.target.value);setError("")}} autoFocus placeholder="e.g. maria" />
      <label className="label">PIN</label><NumericField value={pin} onChange={v=>{setPin(v.replace(/\D/g,"").slice(0,12));setError("")}} placeholder="••••" allowDecimal={false} mask className="auth-numeric" onEnter={submit} defaultOpen />
      {error && <div className="field-error auth-error">{error}</div>}
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="button" className="primary" onClick={submit} disabled={busy}>{busy?"Signing in...":"Login"}</button></div>
    </div>
  </div>, document.body);
}

function CashierAccounts({ onLoad, onSave }) {
  const [items,setItems]=useState([]); const [loading,setLoading]=useState(true); const [editing,setEditing]=useState(null); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
  const load=async()=>{setLoading(true);setError("");try{const d=await onLoad();setItems(d||[])}catch(e){setError(e.message)}finally{setLoading(false)}};
  useEffect(()=>{load()},[]);
  const save=async data=>{setBusy(true);setError("");try{await onSave(data);setEditing(null);await load()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <section className="settings-card cashier-accounts-card"><div className="settings-card-head"><div><div className="eyebrow">STAFF ACCESS</div><h3>Cashier Accounts</h3><p>Create separate cashier logins without giving them Owner access.</p></div><span className="settings-badge">{items.length} account{items.length!==1?"s":""}</span></div>
    {loading?<div className="loading">Loading cashier accounts...</div>:<div className="cashier-list">{items.length===0&&<div className="empty-settings">No cashier accounts yet.</div>}{items.map(c=><div className="cashier-row" key={c.id}><div><strong>{c.name}</strong><small>@{c.username} · {c.isActive?"Active":"Disabled"}</small></div><button className="secondary small-btn" onClick={()=>setEditing(c)}>Edit</button></div>)}</div>}
    {error&&<div className="field-error">{error}</div>}
    <button className="secondary wide" onClick={()=>setEditing({name:"",username:"",pin:"",isActive:true})}>＋ Add Cashier</button>
    {editing&&<CashierAccountForm initial={editing} busy={busy} onSave={save} onClose={()=>!busy&&setEditing(null)} />}
  </section>;
}

function CashierAccountForm({initial,busy,onSave,onClose}){
  const [form,setForm]=useState({...initial,pin:""}); const [error,setError]=useState("");
  const submit=async e=>{e.preventDefault();if(!form.name.trim()){setError("Cashier name is required.");return}if(!/^[A-Za-z0-9._-]{3,32}$/.test(form.username)){setError("Use a valid username with at least 3 characters.");return}if(!initial.id&&!/^\d{4,12}$/.test(form.pin)){setError("PIN must contain 4 to 12 digits.");return}if(form.pin&&!/^\d{4,12}$/.test(form.pin)){setError("PIN must contain 4 to 12 digits.");return}setError("");await onSave({id:initial.id,name:form.name.trim(),username:form.username.trim(),pin:form.pin,isActive:form.isActive!==false})};
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal pop-in" onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">CASHIER ACCOUNT</div><h2>{initial.id?"Edit Cashier":"Add Cashier"}</h2><p>{initial.id?"Update the cashier name, username or PIN.":"Create a separate POS login."}</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div><label className="label">Name</label><input className="text-input" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Maria Santos" autoFocus/><label className="label">Username</label><input className="text-input" value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="maria"/><label className="label">{initial.id?"New PIN (optional)":"PIN"}</label><NumericField value={form.pin} onChange={v=>setForm(f=>({...f,pin:v.replace(/\D/g,"").slice(0,12)}))} placeholder="••••" allowDecimal={false} mask className="auth-numeric"/><label className="check-row"><input type="checkbox" checked={form.isActive!==false} onChange={e=>setForm(f=>({...f,isActive:e.target.checked}))}/><span>Account is active</span></label>{error&&<div className="field-error">{error}</div>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving...":"Save Cashier"}</button></div></form></div>
}

function StaffManagement({ data, loading, filters, onFiltersChange, onRefresh, onHome, onSelectStaff }) {
  const setFilter = (key,value) => onFiltersChange(f => ({...f,[key]:value}));
  const staff = data?.staff || [];
  const selected = data?.selectedStaff;
  const metrics = data?.selectedMetrics || {};
  const money = n => peso(n);
  const fmtDate = value => { const d = new Date(String(value).replace(' ','T')); return Number.isNaN(d.getTime()) ? value : d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); };
  const setPreset = key => { const now=new Date(); const pad=n=>String(n).padStart(2,'0'); const fmt=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; let a=new Date(now), b=new Date(now); if(key==='yesterday'){a.setDate(a.getDate()-1);b.setDate(b.getDate()-1)} if(key==='week'){const day=a.getDay();a.setDate(a.getDate()-(day===0?6:day-1))} if(key==='month'){a=new Date(a.getFullYear(),a.getMonth(),1)} if(key==='year'){a=new Date(a.getFullYear(),0,1)} onFiltersChange(f=>({...f,start:fmt(a),end:fmt(b),page:1})); };
  return <main className="staff-page simple-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="topbar-title"><BrandLogo storeInfo={data?.storeInfo || null}/><div><b>Staff Management</b><small>Staff activity and transaction history</small></div></div><button className="refresh" onClick={onRefresh}>↻ Refresh</button></header>
    <div className="staff-wrap">
      <div className="reports-head"><div><div className="eyebrow">OWNER / ADMIN</div><h2>Staff Management</h2><p>Review sales activity, transaction history and objective work metrics for each staff member.</p></div></div>
      <section className="dashboard-card staff-filter-card"><div className="report-date-fields"><label><span>From</span><input type="date" value={filters.start} onChange={e=>setFilter('start',e.target.value)} /></label><label><span>To</span><input type="date" value={filters.end} onChange={e=>setFilter('end',e.target.value)} /></label><button className="primary report-apply" onClick={onRefresh}>Generate</button></div><div className="history-presets report-presets">{[['today','Today'],['yesterday','Yesterday'],['week','This week'],['month','This month'],['year','This year']].map(([k,l])=><button key={k} onClick={()=>setPreset(k)}>{l}</button>)}</div></section>
      {loading ? <div className="loading">Loading staff activity...</div> : <>
        <div className="metric-grid staff-summary-metrics">
          <div className="metric-card"><span>Staff Accounts</span><strong>{staff.filter(x=>x.role==='Cashier').length}</strong><small>Cashier accounts</small></div>
          <div className="metric-card"><span>Total Transactions</span><strong>{staff.reduce((a,x)=>a+Number(x.metrics?.transactions||0),0).toLocaleString()}</strong><small>Selected period</small></div>
          <div className="metric-card"><span>Net Sales</span><strong>{money(staff.reduce((a,x)=>a+Number(x.metrics?.netSales||0),0))}</strong><small>After refunds</small></div>
          <div className="metric-card"><span>Active Staff</span><strong>{staff.filter(x=>x.role==='Cashier'&&x.isActive).length}</strong><small>Currently enabled</small></div>
        </div>
        <section className="dashboard-card staff-list-card"><div className="card-head"><div><div className="eyebrow">STAFF ACTIVITY</div><h3>Sales activity by staff</h3><p className="card-subtitle">Select a person to view every transaction recorded under their account.</p></div></div>
          <div className="staff-grid">{staff.map(person=>{const m=person.metrics||{}; return <button className={`staff-card ${selected?.id===person.id?'active':''}`} key={person.id} onClick={()=>onSelectStaff(person.id)}><div className="staff-card-head"><div className="staff-avatar">{person.role==='Owner'?'★':'👤'}</div><div><strong>{person.name}</strong><small>{person.role}{person.username?` · @${person.username}`:''}{person.role==='Cashier' ? ` · ${person.isActive?'Active':'Disabled'}` : ''}</small></div></div><div className="staff-stat-grid"><div><span>Net Sales</span><strong>{money(m.netSales)}</strong></div><div><span>Transactions</span><strong>{Number(m.transactions||0).toLocaleString()}</strong></div><div><span>Gross Profit</span><strong>{money(m.grossProfit)}</strong></div><div><span>Avg Sale</span><strong>{money(m.averageSale)}</strong></div><div><span>Refunds</span><strong>{money(m.refunds)}</strong></div><div><span>Discounts</span><strong>{money(m.discounts)}</strong></div></div><div className="staff-card-foot">View transaction history <span>→</span></div></button>})}</div>
        </section>
        {selected && <section className="dashboard-card staff-history-card"><div className="card-head"><div><div className="eyebrow">TRANSACTION HISTORY</div><h3>{selected.name}</h3><p className="card-subtitle">{selected.role} · {filters.start} to {filters.end}</p></div><div className="staff-detail-total"><span>Net Sales</span><strong>{money(metrics.netSales)}</strong></div></div>
          <div className="staff-detail-metrics"><div><span>Transactions</span><strong>{Number(metrics.transactions||0).toLocaleString()}</strong></div><div><span>Gross Sales</span><strong>{money(metrics.grossSales)}</strong></div><div><span>Gross Profit</span><strong>{money(metrics.grossProfit)}</strong></div><div><span>Refunds</span><strong>{money(metrics.refunds)}</strong></div><div><span>Average Sale</span><strong>{money(metrics.averageSale)}</strong></div></div>
          {data.transactions?.length ? <div className="report-table-wrap"><table className="report-table staff-history-table"><thead><tr><th>Transaction</th><th>Date & Time</th><th>Gross</th><th>Discount</th><th>Refund</th><th>Net Sales</th><th>Status</th></tr></thead><tbody>{data.transactions.map(t=><tr key={t.id}><td><strong>{t.transactionNumber}</strong></td><td>{fmtDate(t.createdAt)}</td><td>{money(t.subtotal)}</td><td>{t.discount?`−${money(t.discount)}`:money(0)}</td><td>{t.refundedAmount?`−${money(t.refundedAmount)}`:money(0)}</td><td><strong>{money(t.netSales)}</strong></td><td><span className={`staff-status ${t.refundStatus==='full'?'full':t.refundStatus==='partial'?'partial':'normal'}`}>{t.refundStatus==='full'?'Fully refunded':t.refundStatus==='partial'?'Partially refunded':'Completed'}</span></td></tr>)}</tbody></table></div> : <div className="chart-empty">No transactions for this staff member in the selected period.</div>}
          {data.totalPages>1 && <div className="pagination"><button className="secondary small-btn" disabled={data.page<=1} onClick={()=>onFiltersChange(f=>({...f,page:f.page-1}))}>← Previous</button><span>Page {data.page} of {data.totalPages}</span><button className="secondary small-btn" disabled={data.page>=data.totalPages} onClick={()=>onFiltersChange(f=>({...f,page:f.page+1}))}>Next →</button></div>}
        </section>}
      </>}
    </div>
  </main>;
}

function AuditLog({ data, loading, filters, onFiltersChange, onRefresh, onHome, storeInfo }) {
  const set=(k,v)=>onFiltersChange(f=>({...f,[k]:v,page:1}));
  const fmt=v=>{const d=new Date(String(v).replace(' ','T'));return Number.isNaN(d.getTime())?v:d.toLocaleString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});};
  const preset=key=>{const now=new Date(),pad=n=>String(n).padStart(2,'0'),fmtDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;let a=new Date(now),b=new Date(now);if(key==='yesterday'){a.setDate(a.getDate()-1);b.setDate(b.getDate()-1)}if(key==='week'){const day=a.getDay();a.setDate(a.getDate()-(day===0?6:day-1))}if(key==='month')a=new Date(a.getFullYear(),a.getMonth(),1);if(key==='year')a=new Date(a.getFullYear(),0,1);onFiltersChange(f=>({...f,start:fmtDate(a),end:fmtDate(b),page:1}));};
  const actorLabel=x=>x.actorType==='owner'?'Owner':x.actorType==='cashier'?x.actorName:x.actorType==='unknown'?'Unknown':'System';
  return <main className="audit-page simple-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="topbar-title"><BrandLogo storeInfo={storeInfo||null}/><div><b>Activity & Audit Log</b><small>Important staff and security activity</small></div></div><button className="refresh" onClick={onRefresh}>↻ Refresh</button></header>
    <div className="audit-wrap"><div className="reports-head"><div><div className="eyebrow">OWNER / ADMIN</div><h2>Activity & Audit Log</h2><p>See who performed important actions and when they happened.</p></div></div>
      <section className="dashboard-card audit-filter-card"><div className="report-date-fields"><label><span>From</span><input type="date" value={filters.start} onChange={e=>set('start',e.target.value)}/></label><label><span>To</span><input type="date" value={filters.end} onChange={e=>set('end',e.target.value)}/></label><label><span>Staff</span><select value={filters.staff} onChange={e=>set('staff',e.target.value)}><option value="all">Everyone</option><option value="owner">Owner</option><option value="unknown">Unknown / failed login</option>{(data?.staff||[]).map(x=><option key={x.id} value={x.id}>{x.name}{x.isActive?'':' (disabled)'}</option>)}</select></label><label><span>Action</span><select value={filters.action} onChange={e=>set('action',e.target.value)}><option value="all">All actions</option>{(data?.actions||[]).map(x=><option key={x} value={x}>{x}</option>)}</select></label></div><div className="audit-search-row"><input className="text-input" value={filters.q} onChange={e=>set('q',e.target.value)} placeholder="Search activity..."/><div className="quick-buttons"><button type="button" onClick={()=>preset('today')}>Today</button><button type="button" onClick={()=>preset('week')}>This week</button><button type="button" onClick={()=>preset('month')}>This month</button><button type="button" onClick={()=>preset('year')}>This year</button></div></div></section>
      <section className="dashboard-card audit-list-card"><div className="card-head"><div><div className="eyebrow">ACTIVITY</div><h3>{Number(data?.total||0).toLocaleString()} event{Number(data?.total||0)!==1?'s':''}</h3></div></div>{loading?<div className="loading">Loading activity...</div>:data?.items?.length?<div className="audit-table-wrap"><table className="report-table audit-table"><thead><tr><th>Date & Time</th><th>Staff</th><th>Action</th><th>Details</th></tr></thead><tbody>{data.items.map(x=><tr key={x.id}><td>{fmt(x.createdAt)}</td><td><strong>{actorLabel(x)}</strong></td><td><span className={`audit-action audit-${x.actorType}`}>{x.action}</span></td><td>{x.transactionNumber?<><strong>{x.transactionNumber}</strong>{x.details?` · ${x.details}`:''}</>:x.details}</td></tr>)}</tbody></table></div>:<div className="chart-empty">No activity matches these filters.</div>}{data?.totalPages>1&&<div className="pagination"><button className="secondary small-btn" disabled={data.page<=1} onClick={()=>onFiltersChange(f=>({...f,page:f.page-1}))}>← Previous</button><span>Page {data.page} of {data.totalPages}</span><button className="secondary small-btn" disabled={data.page>=data.totalPages} onClick={()=>onFiltersChange(f=>({...f,page:f.page+1}))}>Next →</button></div>}</section>
      <div className="audit-note">Audit records are stored locally in the SQLite database. PIN values and other secrets are never recorded.</div>
    </div>
  </main>;
}

function DebtTracker({ data, loading, filters, onFiltersChange, onRefresh, onHome, onSaveDebt, onDeleteDebt, onSavePayment, onDeletePayment, storeInfo, adminToken }) {
  const today = new Date(); const pad=n=>String(n).padStart(2,'0'); const todayISO=`${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
  const [formOpen,setFormOpen]=useState(false), [editing,setEditing]=useState(null), [detail,setDetail]=useState(null), [paymentOpen,setPaymentOpen]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(""), [confirm,setConfirm]=useState(null);
  const emptyForm=()=>({supplierName:"",debtDate:todayISO,notes:"",items:[{quantity:"",description:"",cost:""}]});
  const openNew=()=>{setEditing(emptyForm());setFormOpen(true);setError("");};
  const openEdit=async item=>{setError("");try{const full=await api(`/api/debts/${item.id}`,{},adminToken||"");setEditing({id:full.id,supplierName:full.supplierName,debtDate:full.debtDate,notes:full.notes||"",items:full.items.map(x=>({id:x.id,quantity:String(x.quantity ?? 1),description:x.description,cost:String(x.cost)}))});setFormOpen(true);}catch(e){setError(e.message);}};
  const submitDebt=async e=>{e.preventDefault();setBusy(true);setError("");try{const cleanedItems=(editing.items||[]).filter(item=>String(item.quantity??"").trim()!==""||String(item.description??"").trim()!==""||String(item.cost??"").trim()!=="");const cleanedForm={...editing,items:cleanedItems};setEditing(cleanedForm);const saved=await onSaveDebt(cleanedForm);setFormOpen(false);setEditing(null);await onRefresh();if(saved?.id){const full=await api(`/api/debts/${saved.id}`,{},adminToken||"");setDetail(full);}}catch(e){setError(e.message);}finally{setBusy(false);}};
  const openDetail=async item=>{setError("");try{setDetail(await api(`/api/debts/${item.id}`,{},adminToken||""));}catch(e){setError(e.message);}};
  const doDelete=item=>{setConfirm({title:"Delete Supplier Debt?",message:`Delete the debt from ${item.supplierName} for ${peso(item.totalAmount)}? This is only allowed when no payment history exists.`,confirmLabel:"Delete Debt",danger:true,onConfirm:async()=>{setBusy(true);try{await onDeleteDebt(item.id);setDetail(null);await onRefresh();setConfirm(null);}catch(e){setError(e.message);setConfirm(null);}finally{setBusy(false);}}});};
  const statusLabel={unpaid:"Unpaid",partial:"Partially Paid",paid:"Paid"};
  const visible=(data?.items||[]);
  return <main className="simple-page debt-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="topbar-title"><BrandLogo storeInfo={storeInfo||null}/><div><b>Debt Tracker</b><small>Supplier deliveries and unpaid balances</small></div></div><button className="refresh" onClick={onRefresh}>↻ Refresh</button></header>
    <div className="debt-wrap">
      <div className="reports-head"><div><div className="eyebrow">OWNER / ADMIN</div><h2>Debt Tracker</h2><p>Record supplier deliveries, partial payments and remaining balances.</p></div><button className="primary small-btn" onClick={openNew}>＋ Add Supplier Debt</button></div>
      <section className="debt-summary-grid"><div className="debt-summary-card"><span>Outstanding Debt</span><strong>{peso(data?.totals?.balance)}</strong></div><div className="debt-summary-card"><span>Total Recorded</span><strong>{peso(data?.totals?.total)}</strong></div><div className="debt-summary-card"><span>Total Paid</span><strong>{peso(data?.totals?.paid)}</strong></div></section>
      <section className="dashboard-card debt-filter-card"><div className="debt-filter-row"><label><span>Status</span><select value={filters.status} onChange={e=>onFiltersChange({...filters,status:e.target.value,page:1})}><option value="all">All</option><option value="unpaid">Unpaid</option><option value="partial">Partially Paid</option><option value="paid">Paid</option></select></label><label><span>Supplier</span><select value={filters.supplier} onChange={e=>onFiltersChange({...filters,supplier:e.target.value,page:1})}><option value="">All suppliers</option>{(data?.suppliers||[]).map(x=><option key={x.name} value={x.name}>{x.name}</option>)}</select></label><label className="debt-search-field"><span>Search</span><input className="text-input" value={filters.q} onChange={e=>onFiltersChange({...filters,q:e.target.value,page:1})} placeholder="Supplier, supplies or notes..."/></label></div></section>
      <section className="dashboard-card debt-list-card"><div className="card-head"><div><div className="eyebrow">SUPPLIER LEDGER</div><h3>{Number(data?.total||0).toLocaleString()} debt record{Number(data?.total||0)!==1?'s':''}</h3></div></div>{loading?<div className="loading">Loading supplier debts...</div>:visible.length?<div className="debt-table-wrap"><table className="report-table debt-table"><thead><tr><th>Date</th><th>Supplier</th><th>Supplies</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead><tbody>{visible.map(item=><tr key={item.id} className="debt-row" onClick={()=>openDetail(item)}><td>{item.debtDate}</td><td><strong>{item.supplierName}</strong></td><td>{item.notes || "—"}</td><td>{peso(item.totalAmount)}</td><td>{peso(item.paidAmount)}</td><td><strong className={item.balance>0?"debt-balance":"debt-paid"}>{peso(item.balance)}</strong></td><td><span className={`debt-status debt-status-${item.status}`}>{statusLabel[item.status]}</span></td><td><button type="button" className="secondary small-btn" onClick={e=>{e.stopPropagation();openDetail(item)}}>View</button></td></tr>)}</tbody></table></div>:<div className="chart-empty">No supplier debts match these filters.</div>}{data?.totalPages>1&&<div className="pagination"><button className="secondary small-btn" disabled={data.page<=1} onClick={()=>onFiltersChange({...filters,page:data.page-1})}>← Previous</button><span>Page {data.page} of {data.totalPages}</span><button className="secondary small-btn" disabled={data.page>=data.totalPages} onClick={()=>onFiltersChange({...filters,page:data.page+1})}>Next →</button></div>}</section>
    </div>
    {formOpen&&editing&&<DebtFormModal form={editing} setForm={setEditing} busy={busy} error={error} onClose={()=>{if(!busy){setFormOpen(false);setEditing(null);}}} onSubmit={submitDebt}/>} 
    {detail&&<DebtDetailModal detail={detail} busy={busy} onClose={()=>setDetail(null)} onEdit={()=>{setDetail(null);openEdit(detail)}} onDelete={()=>doDelete(detail)} onPayment={()=>{setPaymentOpen(true);setError("")}} onDeletePayment={id=>setConfirm({title:"Delete Payment Record?",message:"Delete this payment record? The remaining balance will increase accordingly.",confirmLabel:"Delete Payment",danger:true,onConfirm:async()=>{setBusy(true);try{await onDeletePayment(detail.id,id);setDetail(await api(`/api/debts/${detail.id}`,{},adminToken||""));await onRefresh();setConfirm(null);}catch(e){setError(e.message);setConfirm(null);}finally{setBusy(false);}}})} error={error}/>} 
    {paymentOpen&&detail&&<PaymentModal detail={detail} busy={busy} error={error} onClose={()=>{if(!busy)setPaymentOpen(false)}} onSubmit={async form=>{setBusy(true);setError("");try{await onSavePayment(detail.id,form);setPaymentOpen(false);setDetail(await api(`/api/debts/${detail.id}`,{},adminToken||""));await onRefresh();}catch(e){setError(e.message);}finally{setBusy(false);}}}/>}
    {confirm&&<ConfirmModal title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} busyLabel={confirm.confirmLabel?.replace(/^Delete /,"Deleting ")||"Working..."} onConfirm={confirm.onConfirm} onCancel={()=>{if(!busy)setConfirm(null)}} busy={busy}/>}
  </main>;
}

function DebtFormModal({form,setForm,busy,error,onClose,onSubmit}){
  const quantityRefs=useRef({});
  const setItem=(i,key,value)=>setForm(f=>({...f,items:f.items.map((x,n)=>n===i?{...x,[key]:value}:x)}));
  const total=form.items.reduce((s,x)=>s+(Number(x.cost)||0),0);
  useEffect(()=>{
    const first=quantityRefs.current[0];
    if(first) setTimeout(()=>first.focus(),0);
  },[]);
  const addRowAfter=(i)=>{
    const nextIndex=i+1;
    setForm(f=>({...f,items:[...f.items.slice(0,nextIndex),{quantity:"",description:"",cost:""},...f.items.slice(nextIndex)]}));
    setTimeout(()=>quantityRefs.current[nextIndex]?.focus(),0);
  };
  const handleCostKeyDown=(e,i)=>{
    if(e.key!=='Enter') return;
    e.preventDefault();
    const item=form.items[i];
    if(!String(item.quantity??"").trim() || !item.description.trim() || !(Number(item.cost)>=0)) return;
    addRowAfter(i);
  };
  return <div className="modal-backdrop"><form className="modal debt-form-modal" onSubmit={onSubmit}>
    <div className="modal-head"><div><div className="eyebrow">SUPPLIER DEBT</div><h2>{form.id?"Edit Supplier Debt":"Add Supplier Debt"}</h2><p>Record what was delivered and what you owe.</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
    <div className="form-two"><label><span className="label">Date</span><input className="text-input" type="date" value={form.debtDate} onChange={e=>setForm({...form,debtDate:e.target.value})} required/></label><label><span className="label">Supplier</span><input className="text-input" value={form.supplierName} onChange={e=>setForm({...form,supplierName:e.target.value})} placeholder="Supplier name" required/></label></div>
    <div className="label debt-items-label">Supplies</div>
    <div className="debt-item-editor">
      <div className="debt-item-edit-row debt-item-edit-head"><span>Quantity</span><span>Supply</span><span>Cost</span><span></span></div>
      {form.items.map((item,i)=><div className="debt-item-edit-row" key={i}>
        <input ref={el=>{quantityRefs.current[i]=el}} className="text-input debt-qty-input" inputMode="text" value={item.quantity} onChange={e=>setItem(i,"quantity",e.target.value)} placeholder="e.g. 1 crate" aria-label={`Supply ${i+1} quantity`} />
        <input className="text-input" value={item.description} onChange={e=>setItem(i,"description",e.target.value)} placeholder="Supply description" aria-label={`Supply ${i+1} description`} />
        <input className="text-input debt-cost-input" inputMode="decimal" value={item.cost} onChange={e=>setItem(i,"cost",e.target.value)} onKeyDown={e=>handleCostKeyDown(e,i)} placeholder="Cost" aria-label={`Supply ${i+1} total cost`} />
        <button type="button" tabIndex={-1} className="icon-btn debt-remove-line" disabled={form.items.length===1} onClick={()=>setForm(f=>({...f,items:f.items.filter((_,n)=>n!==i)}))} aria-label={`Remove supply ${i+1}`}>×</button>
      </div>)}
      <div className="debt-entry-hint">Tip: Quantity → Tab → Supply → Tab → Cost → Enter adds the next row and focuses Quantity.</div>
    </div>
    <label><span className="label">Notes <small>(optional)</small></span><textarea className="text-input debt-notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Optional delivery notes..."/></label>
    <div className="debt-total-box"><span>Total Debt</span><strong>{peso(total)}</strong></div>{error&&<div className="field-error">{error}</div>}
    <div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy||total<=0}>{busy?"Saving...":"Save Debt"}</button></div>
  </form></div>;
}
function DebtDetailModal({detail,busy,onClose,onEdit,onDelete,onPayment,onDeletePayment,error}){
  const status=detail.status; const label=status==='paid'?'Paid':status==='partial'?'Partially Paid':'Unpaid';
  return <div className="modal-backdrop"><div className="modal debt-detail-modal"><div className="modal-head"><div><div className="eyebrow">SUPPLIER DEBT</div><h2>{detail.supplierName}</h2><p>{detail.debtDate} · <span className={`debt-status debt-status-${status}`}>{label}</span></p></div><button className="icon-btn" onClick={onClose}>×</button></div><div className="debt-detail-total"><div><span>Original Debt</span><strong>{peso(detail.totalAmount)}</strong></div><div><span>Total Paid</span><strong>{peso(detail.paidAmount)}</strong></div><div><span>Remaining</span><strong className={detail.balance>0?"debt-balance":"debt-paid"}>{peso(detail.balance)}</strong></div></div><section className="debt-detail-section"><div className="debt-section-head"><h3>Supplies Received</h3><span>{detail.items.length} line{detail.items.length!==1?'s':''}</span></div><div className="debt-lines">{detail.items.map(x=><div className="debt-line" key={x.id}><div className="debt-line-main"><strong className="debt-line-qty">{String(x.quantity ?? "1")}</strong><span>{x.description}</span></div><strong>{peso(x.cost)}</strong></div>)}</div>{detail.notes&&<div className="debt-note"><strong>Notes:</strong> {detail.notes}</div>}</section><section className="debt-detail-section"><div className="debt-section-head"><h3>Payment History</h3><button className="primary small-btn" onClick={onPayment} disabled={detail.balance<=0}>＋ Record Payment</button></div>{detail.payments.length?<div className="debt-lines">{detail.payments.map(x=><div className="debt-line" key={x.id}><div><strong>{x.paymentDate}</strong>{x.notes&&<small>{x.notes}</small>}</div><div className="debt-payment-right"><strong>{peso(x.amount)}</strong><button className="icon-btn mini-delete" disabled={busy} onClick={()=>onDeletePayment(x.id)}>×</button></div></div>)}</div>:<div className="chart-empty debt-empty">No payments recorded yet.</div>}</section>{error&&<div className="field-error">{error}</div>}<div className="form-actions"><button className="secondary" onClick={onEdit} disabled={busy}>Edit Debt</button><button className="danger" onClick={onDelete} disabled={busy||detail.payments.length>0}>Delete</button><button className="primary" onClick={onClose}>Done</button></div></div></div>;
}

function PaymentModal({detail,busy,error,onClose,onSubmit}){
  const d=new Date(), pad=n=>String(n).padStart(2,'0'); const today=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; const [form,setForm]=useState({paymentDate:today,amount:"",notes:""});
  return <div className="modal-backdrop"><form className="modal payment-modal" onSubmit={e=>{e.preventDefault();onSubmit(form)}}><div className="modal-head"><div><div className="eyebrow">SUPPLIER PAYMENT</div><h2>Record Payment</h2><p>{detail.supplierName} · Remaining {peso(detail.balance)}</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div><label><span className="label">Payment Date</span><input className="text-input" type="date" value={form.paymentDate} onChange={e=>setForm({...form,paymentDate:e.target.value})} required/></label><label><span className="label">Amount</span><input className="big-input" inputMode="decimal" autoFocus value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} placeholder="0.00" required/></label><div className="calculation"><div><span>Remaining before payment</span><strong>{peso(detail.balance)}</strong></div><div className="calc-total"><span>Remaining after payment</span><strong>{peso(Math.max(0,detail.balance-(Number(form.amount)||0)))}</strong></div></div><label><span className="label">Notes <small>(optional)</small></span><textarea className="text-input debt-notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} placeholder="Optional payment note..."/></label>{error&&<div className="field-error">{error}</div>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary" disabled={busy||!(Number(form.amount)>0)||Number(form.amount)>detail.balance+0.005}>{busy?"Saving...":"Save Payment"}</button></div></form></div>;
}

function OwnerMenu({ onProducts, onDashboard, onReports, onSettings, onStaff, onAudit, onDebt, onLock, onHome, storeInfo }) {
  return <main className="owner-menu-page">
    <div className="owner-menu-wrap">
      <button className="owner-back" onClick={onHome}><span className="back-arrow">←</span><span>Home</span></button>
      <div className="owner-menu-head">
        <div className="owner-menu-icon"><BrandLogo storeInfo={storeInfo} /></div>
        <div><div className="eyebrow">OWNER / ADMIN</div><h1>Owner Center</h1><p>Manage products, business performance and security.</p></div>
      </div>
      <div className="owner-menu-grid">
        <button className="owner-menu-card" onClick={onDashboard}><span className="owner-menu-card-icon">▥</span><div><b>Business Dashboard</b><small>Sales, profit and accounting</small></div><i>→</i></button>
        <button className="owner-menu-card" onClick={onReports}><span className="owner-menu-card-icon">▤</span><div><b>Sales Reports</b><small>Detailed sales records and summaries</small></div><i>→</i></button>
        <button className="owner-menu-card" onClick={onProducts}><span className="owner-menu-card-icon">▦</span><div><b>Manage Products</b><small>Products, prices and categories</small></div><i>→</i></button>
        <button className="owner-menu-card" onClick={onStaff}><span className="owner-menu-card-icon">👥</span><div><b>Staff Management</b><small>Staff activity and transaction history</small></div><i>→</i></button><button className="owner-menu-card" onClick={onDebt}><span className="owner-menu-card-icon">₱</span><div><b>Debt Tracker</b><small>Supplier deliveries and payments</small></div><i>→</i></button><button className="owner-menu-card" onClick={onAudit}><span className="owner-menu-card-icon">◷</span><div><b>Activity &amp; Audit Log</b><small>Security and important staff actions</small></div><i>→</i></button>
        <button className="owner-menu-card" onClick={onSettings}><span className="owner-menu-card-icon">⚙</span><div><b>Owner / Admin Settings</b><small>Passcode, recovery and session lock</small></div><i>→</i></button>
      </div>
      <button className="owner-lock" onClick={onLock}>🔒 Lock Admin Access</button>
      <p className="owner-menu-note">Owner features are protected by your admin passcode.</p>
    </div>
  </main>;
}

function BackupRestore({ onBackup, onRestore }) {
  const [busy,setBusy]=useState(false), [message,setMessage]=useState(""), [error,setLocalError]=useState("");
  const [pendingFile,setPendingFile]=useState(null), [schemaWarning,setSchemaWarning]=useState(null);
  const fileRef=useRef(null);
  const backup=async()=>{setBusy(true);setMessage("");setLocalError("");try{await onBackup();setMessage("Backup downloaded successfully.");}catch(e){setLocalError(e.message||"Could not create the backup.");}finally{setBusy(false);}};
  const chooseRestore=e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setMessage("");setLocalError("");if(!file.name.toLowerCase().endsWith(".zip")&&!file.name.toLowerCase().endsWith(".sqlite")){setLocalError("Please choose a .zip complete backup or a legacy .sqlite Grocery POS backup.");return;}setPendingFile(file);};
  const performRestore=async(allowSchemaMismatch=false)=>{if(!pendingFile)return;setBusy(true);setLocalError("");try{const result=await onRestore(pendingFile,allowSchemaMismatch);if(result?.needsSchemaConfirmation){setSchemaWarning(result);setBusy(false);return;}setPendingFile(null);setSchemaWarning(null);}catch(err){setLocalError(err.message||"Could not restore the backup.");setBusy(false);}};
  return <section className="settings-card backup-card">
    <div className="settings-card-head"><div><div className="eyebrow">DATA SAFETY</div><h3>Backup & Restore</h3><p>Download a complete POS backup containing your database and uploaded product images, or restore a previous backup.</p></div><span className="settings-badge good">Complete</span></div>
    <div className="backup-actions"><button className="secondary" onClick={backup} disabled={busy}>{busy?"Working...":"⇩ Download Backup"}</button><button className="secondary" onClick={()=>fileRef.current?.click()} disabled={busy}>⇧ Restore Backup</button><input ref={fileRef} type="file" accept=".zip,.sqlite,application/zip,application/x-sqlite3" onChange={chooseRestore} hidden /></div>
    <div className="backup-note"><strong>Complete backup:</strong> The downloaded <code>.zip</code> contains <code>pos.sqlite</code> plus the <code>product-images/</code> folder. Store logo/receipt settings are already inside the database. Older <code>.sqlite</code> backups remain supported, but they cannot contain uploaded product images.</div>
    {message&&<div className="backup-success">{message}</div>}{error&&<div className="field-error">{error}</div>}
    {pendingFile&&!schemaWarning&&<ConfirmModal title="Restore Backup?" message={<><strong>{pendingFile.name}</strong><br/><br/>This will replace the POS business data and, for complete ZIP backups, the product images currently stored in this POS. Your current machine's admin passcode and security credentials will be kept. A fresh backup should be made first if you want to keep the current data.</>} confirmLabel="Restore Backup" danger busy={busy} onConfirm={()=>performRestore(false)} onCancel={()=>{if(!busy)setPendingFile(null)}} />}
    {schemaWarning&&<ConfirmModal title="Backup Version Difference" message={<>{schemaWarning.warning||"This backup was created with a different database schema. Compatible fields will be restored and newer fields will keep their current defaults."}{schemaWarning.mismatches?.length>0&&<div className="confirm-schema-list">{schemaWarning.mismatches.map((m,i)=><div key={i}><strong>{m.table}</strong>{m.missingInBackup?.length?<> · Missing: {m.missingInBackup.join(", ")}</>:null}{m.extraInBackup?.length?<> · Extra: {m.extraInBackup.join(", ")}</>:null}</div>)}</div>}<br/><strong>Your current admin/security credentials will not be replaced.</strong></>} confirmLabel="Restore Anyway" danger busy={busy} onConfirm={()=>performRestore(true)} onCancel={()=>{if(!busy){setSchemaWarning(null);setPendingFile(null)}}} />}
  </section>;
}

function StoreInfoSettings({ storeInfo, loading, onLoad, onSave }) {
  const [form, setForm] = useState({ storeName:"Grocery POS", tagline:"Simple. Fast. Made for your store.", address:"", contact:"", logoData:"" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => { onLoad().then(data => data && setForm({ storeName:data.storeName || "Grocery POS", tagline:data.tagline || "", address:data.address || "", contact:data.contact || "", logoData:data.logoData || "" })).catch(e => setError(e.message || "Could not load store information.")); }, []);
  useEffect(() => { if (storeInfo) setForm({ storeName:storeInfo.storeName || "Grocery POS", tagline:storeInfo.tagline || "", address:storeInfo.address || "", contact:storeInfo.contact || "", logoData:storeInfo.logoData || "" }); }, [storeInfo]);
  const chooseLogo = async e => { const file=e.target.files?.[0]; e.target.value=""; if(!file)return; setError(""); setSaved(""); try { const logoData = await compressImage(file); setForm(f=>({...f,logoData})); } catch(err){setError(err.message||"Could not read the logo.");} };
  const save = async e => { e.preventDefault(); if(!form.storeName.trim()){setError("Store name is required.");return;} setBusy(true);setError("");setSaved(""); try { const result=await onSave({...form,storeName:form.storeName.trim(),tagline:form.tagline.trim(),address:form.address.trim(),contact:form.contact.trim()}); setForm({...result}); setSaved("Store information saved."); } catch(err){setError(err.message||"Could not save store information.");} finally{setBusy(false);} };
  return <section className="settings-card store-info-card">
    <div className="settings-card-head"><div><div className="eyebrow">STORE INFORMATION</div><h3>Customize Your POS</h3><p>Set the store name, contact details and logo shown throughout the POS.</p></div><span className="settings-badge good">Branding</span></div>
    {loading && !storeInfo ? <div className="loading">Loading store information...</div> : <form onSubmit={save}>
      <div className="store-brand-editor"><div className="store-logo-preview"><BrandLogo storeInfo={form} /></div><div><label className="label">Store Logo</label><p className="form-hint">Use PNG, JPG or WebP. A square logo works best. If no logo is saved, the default ✦ logo is used.</p><div className="image-actions"><label className="secondary file-button">📷 Choose Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseLogo} /></label>{form.logoData && <button type="button" className="secondary file-button" onClick={()=>setForm(f=>({...f,logoData:""}))}>Remove Logo</button>}</div></div></div>
      <div className="form-two"><div><label className="label">Store Name</label><input className="text-input" maxLength="80" value={form.storeName} onChange={e=>setForm(f=>({...f,storeName:e.target.value}))} placeholder="My Grocery Store" /></div><div><label className="label">Tagline</label><input className="text-input" maxLength="120" value={form.tagline} onChange={e=>setForm(f=>({...f,tagline:e.target.value}))} placeholder="Fresh. Fast. Local." /></div></div>
      <div className="form-two"><div><label className="label">Address</label><input className="text-input" maxLength="200" value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="Store address" /></div><div><label className="label">Contact</label><input className="text-input" maxLength="120" value={form.contact} onChange={e=>setForm(f=>({...f,contact:e.target.value}))} placeholder="Phone / Facebook / contact info" /></div></div>
      {error && <div className="field-error">{error}</div>}{saved && <div className="backup-success">{saved}</div>}<div className="form-actions"><button className="primary" disabled={busy}>{busy?"Saving...":"Save Store Information"}</button></div>
    </form>}
  </section>;
}

function ReceiptSettings({ settings, loading, onLoad, onSave, storeInfo }) {
  const [form,setForm]=useState(DEFAULT_RECEIPT_SETTINGS); const [busy,setBusy]=useState(false); const [saved,setSaved]=useState(''); const [error,setError]=useState('');
  useEffect(()=>{onLoad().then(d=>d&&setForm({...DEFAULT_RECEIPT_SETTINGS,...d})).catch(e=>setError(e.message||'Could not load receipt settings.'));},[]);
  useEffect(()=>{if(settings)setForm({...DEFAULT_RECEIPT_SETTINGS,...settings});},[settings]);
  const toggle=k=>setForm(f=>({...f,[k]:!f[k]}));
  const save=async()=>{setBusy(true);setSaved('');setError('');try{const d=await onSave(form);setForm({...DEFAULT_RECEIPT_SETTINGS,...d});setSaved('Receipt settings saved.');}catch(e){setError(e.message||'Could not save receipt settings.')}finally{setBusy(false)}};
  const opts=[['showLogo','Store logo'],['showStoreName','Store name'],['showTagline','Tagline'],['showAddress','Address'],['showContact','Contact information'],['showTransactionNumber','Transaction number'],['showDatetime','Date & time'],['showPaymentMethod','Payment method']];
  const previewSale={transactionNumber:'TX-000123',subtotal:207.5,discount:10,total:197.5,cashReceived:200,changeAmount:2.5,createdAt:new Date().toISOString().replace('T',' ').slice(0,19),items:[{id:1,name:'Banana',priceType:'retail',quantity:1.25,unit:'kg',unitPrice:70,total:87.5},{id:2,name:'Apple',priceType:'retail',quantity:2,unit:'piece',unitPrice:60,total:120}]};
  return <section className="settings-card receipt-settings-card">
    <div className="settings-card-head"><div><div className="eyebrow">RECEIPT CUSTOMIZATION</div><h3>Customize Digital Receipts</h3><p>Choose what customers see on receipts and preview the result before saving.</p></div><span className="settings-badge good">Receipt</span></div>
    {loading&&!settings?<div className="loading">Loading receipt settings...</div>:<div className="receipt-settings-layout">
      <div><div className="receipt-setting-section"><h4>Header &amp; details</h4><div className="receipt-toggle-grid">{opts.map(([k,l])=><label key={k} className="receipt-toggle"><span>{l}</span><input type="checkbox" checked={!!form[k]} onChange={()=>toggle(k)}/><i className="toggle-ui" /></label>)}</div></div>
      <div className="receipt-setting-section"><h4>Appearance</h4><div className="setting-inline"><div><label className="label">Logo size</label><div className="timeout-options">{[['small','Small'],['medium','Medium'],['large','Large']].map(([v,l])=><button type="button" key={v} className={form.logoSize===v?'active':''} onClick={()=>setForm(f=>({...f,logoSize:v}))}>{l}</button>)}</div></div><div><label className="label">Layout</label><div className="timeout-options">{[['standard','Standard'],['compact','Compact']].map(([v,l])=><button type="button" key={v} className={form.layout===v?'active':''} onClick={()=>setForm(f=>({...f,layout:v}))}>{l}</button>)}</div></div></div></div>
      <div className="receipt-setting-section"><h4>Footer</h4><label className="label">Thank-you message</label><textarea className="text-input receipt-textarea" maxLength="160" value={form.footerMessage} onChange={e=>setForm(f=>({...f,footerMessage:e.target.value}))} placeholder="Thank you for shopping with us!"/><label className="label">Receipt note</label><textarea className="text-input receipt-textarea" maxLength="160" value={form.refundMessage} onChange={e=>setForm(f=>({...f,refundMessage:e.target.value}))} placeholder="Please keep this receipt for your records."/></div>
      {error&&<div className="field-error">{error}</div>}{saved&&<div className="backup-success">{saved}</div>}<div className="form-actions"><button type="button" className="primary" onClick={save} disabled={busy}>{busy?'Saving...':'Save Receipt Settings'}</button></div></div>
      <div className="receipt-preview-wrap"><div className="eyebrow">LIVE PREVIEW</div><ReceiptView sale={previewSale} storeInfo={storeInfo||{storeName:'Grocery POS',tagline:'Simple. Fast. Made for your store.',address:'Store address',contact:'Contact'}} receiptSettings={form} preview/></div>
    </div>}
  </section>;
}

function OwnerSettings({ settings, loading, onLoad, onChangePasscode, onGenerateRecovery, onChangeTimeout, onLock, onHome, onBackup, onRestore, storeInfo, storeInfoLoading, onLoadStoreInfo, onSaveStoreInfo, receiptSettings, receiptSettingsLoading, onLoadReceiptSettings, onSaveReceiptSettings, onLoadCashiers, onSaveCashier }) {
  const [changeOpen, setChangeOpen] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryVisible, setRecoveryVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { onLoad().catch(() => {}); }, []);
  const generate = async () => {
    setBusy(true);
    try { const result = await onGenerateRecovery(); setRecoveryCode(result.recoveryCode); setRecoveryVisible(true); } finally { setBusy(false); }
  };
  return <main className="simple-page settings-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="top-title"><BrandLogo storeInfo={storeInfo} className="mini-logo" /><h1>Owner / Admin Settings</h1></div><button className="refresh" onClick={onLock}>🔒 Lock</button></header>
    <div className="settings-wrap">
      <div className="settings-head"><div><div className="eyebrow">SECURITY</div><h2>Owner Access</h2><p>Manage your admin passcode, recovery code and automatic lock.</p></div></div>
      {loading && !settings ? <div className="loading">Loading security settings...</div> : <div className="settings-grid">
        <section className="settings-card"><div className="settings-card-head"><div><div className="eyebrow">PASSCODE</div><h3>Admin Passcode</h3><p>Used for refunds, products, dashboard and these settings.</p></div><span className="settings-badge">Protected</span></div><button className="secondary wide" onClick={() => setChangeOpen(true)}>Change Admin Passcode</button></section>
        <section className="settings-card"><div className="settings-card-head"><div><div className="eyebrow">RECOVERY</div><h3>Recovery Code</h3><p>{settings?.hasRecoveryCode ? "A recovery code is configured." : "No recovery code is configured yet."}</p></div><span className={`settings-badge ${settings?.hasRecoveryCode ? "good" : "warn"}`}>{settings?.hasRecoveryCode ? "Ready" : "Not set"}</span></div><button className="secondary wide" onClick={generate} disabled={busy}>{busy ? "Generating..." : settings?.hasRecoveryCode ? "Generate New Recovery Code" : "Generate Recovery Code"}</button>{recoveryVisible && <div className="recovery-created-inline"><strong>{recoveryCode}</strong><button className="secondary small-btn" onClick={() => navigator.clipboard?.writeText(recoveryCode)}>Copy</button><small>Save this code. The previous recovery code is no longer valid.</small></div>}</section>
        <section className="settings-card"><div className="settings-card-head"><div><div className="eyebrow">AUTO LOCK</div><h3>Admin Session Timeout</h3><p>Lock owner features after inactivity.</p></div></div><div className="timeout-options">{[[5,"5 min"],[10,"10 min"],[15,"15 min"],[30,"30 min"],[0,"Never"]].map(([v,label]) => <button type="button" key={v} className={settings?.sessionTimeoutMinutes === v ? "active" : ""} onClick={async () => { await onChangeTimeout(v); }}>{label}</button>)}</div><small className="form-hint">{settings?.sessionTimeoutMinutes === 0 ? "The Owner/Admin session will remain active until you lock it manually." : "The server also expires the admin session after the selected timeout."}</small></section>
        <section className="settings-card danger-card"><div className="settings-card-head"><div><div className="eyebrow">SESSION</div><h3>Lock Admin Access</h3><p>Immediately end the current owner session.</p></div></div><button className="danger wide" onClick={onLock}>🔒 Lock Now</button></section>
        <StoreInfoSettings storeInfo={storeInfo} loading={storeInfoLoading} onLoad={onLoadStoreInfo} onSave={onSaveStoreInfo} />
        <ReceiptSettings settings={receiptSettings} loading={receiptSettingsLoading} onLoad={onLoadReceiptSettings} onSave={onSaveReceiptSettings} storeInfo={storeInfo} />
        <CashierAccounts onLoad={onLoadCashiers} onSave={onSaveCashier} />
        <BackupRestore onBackup={onBackup} onRestore={onRestore} />
      </div>}
    </div>
    {changeOpen && <ChangePasscodeForm busy={busy} onSave={async data => { setBusy(true); try { await onChangePasscode(data); setChangeOpen(false); } finally { setBusy(false); } }} onClose={() => !busy && setChangeOpen(false)} />}
  </main>;
}

function ChangePasscodeForm({ onSave, onClose, busy }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState("");
  const set=(k,v)=>{setErrors(e=>({...e,[k]:""}));setServerError("");if(k==="current")setCurrent(v);if(k==="next")setNext(v);if(k==="confirm")setConfirm(v)};
  const submit=async e=>{e.preventDefault();const er={};if(!/^\d{4,12}$/.test(current))er.current="Enter your current 4 to 12 digit passcode.";if(!/^\d{4,12}$/.test(next))er.next="Use 4 to 12 digits.";if(next!==confirm)er.confirm="The passcodes do not match.";setErrors(er);if(Object.keys(er).length)return;setServerError("");try{await onSave({currentPasscode:current,newPasscode:next})}catch(err){setServerError(err.message||"Could not change the passcode.")}};
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal pop-in" onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">SECURITY</div><h2>Change Admin Passcode</h2><p>Verify your current passcode before choosing a new one.</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div><label className="label">Current Passcode</label><NumericField value={current} onChange={v=>set("current",v.replace(/\D/g,"").slice(0,12))} placeholder="••••" allowDecimal={false} mask className={errors.current?"field-invalid":""}/>{errors.current&&<div className="field-error">{errors.current}</div>}<label className="label">New Passcode</label><NumericField value={next} onChange={v=>set("next",v.replace(/\D/g,"").slice(0,12))} placeholder="••••" allowDecimal={false} mask className={errors.next?"field-invalid":""}/>{errors.next&&<div className="field-error">{errors.next}</div>}<label className="label">Confirm New Passcode</label><NumericField value={confirm} onChange={v=>set("confirm",v.replace(/\D/g,"").slice(0,12))} placeholder="••••" allowDecimal={false} mask className={errors.confirm?"field-invalid":""}/>{errors.confirm&&<div className="field-error">{errors.confirm}</div>}{serverError&&<div className="field-error">{serverError}</div>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy?"Changing...":"Change Passcode"}</button></div></form></div>;
}

function ProductForm({ initial, categories, onSave, onDelete, onClose }) {
  const [form, setForm] = useState(initial || { name:"", barcode:"", unit:"kg", retail:"", wholesale:"", costPrice:"", emoji:"🛒", imageData:"", categoryId:"" });
  const [saving, setSaving] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [localError, setLocalError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [emojiOpen, setEmojiOpen] = useState(false);
  const set = (key, value) => { setForm(f => ({ ...f, [key]: value })); setFieldErrors(e => ({ ...e, [key]: "" })); };
  const chooseImage = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageBusy(true); setLocalError("");
    try { set("imageData", await compressImage(file)); } catch (err) { setLocalError(err.message || "Could not read the image."); } finally { setImageBusy(false); e.target.value = ""; }
  };
  const submit = async e => {
    e.preventDefault();
    const errors = {};
    if (!form.name.trim()) errors.name = "Product name is required.";
    if (String(form.retail ?? "").trim() === "") errors.retail = "Enter the retail price.";
    else if (!Number.isFinite(Number(form.retail)) || Number(form.retail) <= 0) errors.retail = "Enter a price greater than 0.";
    if (String(form.wholesale ?? "").trim() === "") errors.wholesale = "Enter the wholesale price.";
    else if (!Number.isFinite(Number(form.wholesale)) || Number(form.wholesale) <= 0) errors.wholesale = "Enter a price greater than 0.";
    if (String(form.costPrice ?? "").trim() === "") { if (!initial?.id) errors.costPrice = "Enter the product cost."; }
    else if (!Number.isFinite(Number(form.costPrice)) || Number(form.costPrice) < 0) errors.costPrice = "Enter a valid cost price.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    setSaving(true);
    setLocalError("");
    try { await onSave({ ...form, retail: Number(form.retail), wholesale: Number(form.wholesale), costPrice: Number(form.costPrice || 0), categoryId: form.categoryId ? Number(form.categoryId) : null, isAvailable: initial?.isAvailable !== false }); onClose(); }
    catch (err) { setLocalError(err.message || "Could not save product."); }
    finally { setSaving(false); }
  };
  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal pop-in product-form-modal" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">PRODUCT</div><h2>{initial ? "Edit Product" : "Add Product"}</h2></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div>
      <label className="label">Product Name</label><input className={`text-input ${fieldErrors.name ? "field-invalid" : ""}`} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Onion" autoFocus />{fieldErrors.name && <div className="field-error">{fieldErrors.name}</div>}
      <label className="label">Barcode <small className="optional-label">optional</small></label><input className="text-input" value={form.barcode || ""} onChange={e => set("barcode", e.target.value.replace(/\s+/g, "").slice(0,64))} placeholder="e.g. 4801234567890" inputMode="numeric" autoComplete="off" /><small className="form-hint">Used by the Scan Product feature. Leave blank if this product has no barcode.</small>
      <div className="product-image-editor"><div className="product-image-preview">{form.imageData ? <img src={form.imageData} alt="Preview" /> : <span>{form.emoji || "🛒"}</span>}</div><div className="image-editor-copy"><label className="label">Product Image</label><p>Use a real product photo instead of an emoji. It will be stored locally with your POS database.</p><div className="image-actions"><label className="secondary file-button">{imageBusy ? "Processing..." : "📷 Choose Image"}<input type="file" accept="image/*" onChange={chooseImage} disabled={imageBusy} /></label>{form.imageData && <button type="button" className="secondary file-button" onClick={() => set("imageData", "")}>Remove Image</button>}</div></div></div>
      <div className="form-two"><div><label className="label">Unit</label><select className="text-input" value={form.unit} onChange={e => set("unit", e.target.value)}><option value="kg">Kilogram (kg)</option><option value="piece">Piece</option></select></div><div className="emoji-field"><label className="label">Emoji Fallback</label><div className="emoji-input-row"><input className="text-input" value={form.emoji} onChange={e => set("emoji", e.target.value)} placeholder="🥕" /><button type="button" className="secondary emoji-picker-btn" onClick={() => setEmojiOpen(v => !v)} aria-label="Choose emoji">😀</button></div>{emojiOpen && <EmojiPicker value={form.emoji} onChange={emoji => set("emoji", emoji)} onClose={() => setEmojiOpen(false)} />}</div></div>
      <div className="form-three"><div><label className="label">Retail Price</label><NumericField value={String(form.retail ?? "")} onChange={v => set("retail", v)} placeholder="0.00" className={fieldErrors.retail ? "field-invalid" : ""} />{fieldErrors.retail && <div className="field-error">{fieldErrors.retail}</div>}</div><div><label className="label">Wholesale Price</label><NumericField value={String(form.wholesale ?? "")} onChange={v => set("wholesale", v)} placeholder="0.00" className={fieldErrors.wholesale ? "field-invalid" : ""} />{fieldErrors.wholesale && <div className="field-error">{fieldErrors.wholesale}</div>}</div><div><label className="label">Cost Price</label><NumericField value={String(form.costPrice ?? "")} onChange={v => set("costPrice", v)} placeholder="0.00" className={fieldErrors.costPrice ? "field-invalid" : ""} />{fieldErrors.costPrice && <div className="field-error">{fieldErrors.costPrice}</div>}<small className="form-hint">Used to estimate gross profit.</small></div></div>
      <label className="label">Category</label><select className="text-input" value={form.categoryId || ""} onChange={e => set("categoryId", e.target.value)}><option value="">Uncategorized</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      {localError && <div className="error-text">{localError}</div>}
      <div className="form-actions">{initial?.id && !initial?.isDeleted && <button type="button" className="danger" disabled={saving || imageBusy} onClick={() => { onDelete?.(initial); onClose(); }}>Delete</button>}<button type="button" className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={saving || imageBusy}>{saving ? "Saving..." : "Save Product"}</button></div>
    </form>
  </div>;
}

function CategoryForm({ onSave, onClose }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState("");
  const [fieldError, setFieldError] = useState("");

  const submit = async e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setFieldError("Category name is required."); return; }
    setFieldError("");
    setSaving(true);
    setLocalError("");
    try {
      await onSave(trimmed);
      onClose();
    } catch (e) {
      setLocalError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={onClose}>
    <form className="modal pop-in" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head">
        <div><div className="eyebrow">CATALOG</div><h2>Add Category</h2><p>Create a category for your products.</p></div>
        <button type="button" className="icon-btn" onClick={onClose}>×</button>
      </div>
      <label className="label">Category Name</label>
      <input
        className={`text-input ${fieldError ? "field-invalid" : ""}`}
        value={name}
        onChange={e => { setName(e.target.value); setFieldError(""); }}
        placeholder="e.g. Beverages"
        autoFocus
      />
      {fieldError && <div className="field-error">{fieldError}</div>}
      {localError && <div className="error-text">{localError}</div>}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>Cancel</button>
        <button className="primary" disabled={saving || !name.trim()}>{saving ? "Saving..." : "Add Category"}</button>
      </div>
    </form>
  </div>;
}

function RefundSelectionModal({ transaction, onCancel, onContinue }) {
  const available = (transaction.items || []).map(i => Math.max(0, Number(i.quantity) - Number(i.refundedQuantity || 0)));
  const [quantities, setQuantities] = useState(() => Object.fromEntries((transaction.items || []).map(i => [i.id, ""])));
  const [amounts, setAmounts] = useState(() => Object.fromEntries((transaction.items || []).map(i => [i.id, ""])));
  const [modes, setModes] = useState(() => Object.fromEntries((transaction.items || []).map(i => [i.id, "weight"])));
  const [exactAll, setExactAll] = useState({});
  const [error, setError] = useState("");
  const discountFactor = Number(transaction.subtotal) > 0 ? Math.max(0, Math.min(1, (Number(transaction.subtotal) - Number(transaction.discount || 0)) / Number(transaction.subtotal))) : 1;
  const effectivePrice = item => Number(item.unitPrice) * discountFactor;
  const formatWeight = value => Number(value || 0).toFixed(3);
  const formatAmount = value => Number(value || 0).toFixed(2);
  const selected = (transaction.items || []).map((i, idx) => ({
    ...i,
    available: available[idx],
    selected: exactAll[i.id] != null ? exactAll[i.id] : Number(quantities[i.id] || 0)
  })).filter(i => i.selected > 0);
  const refundAmount = selected.reduce((sum, i) => sum + i.selected * Number(i.unitPrice) * discountFactor, 0);

  const setWeight = (item, value) => {
    const raw = String(value ?? "").replace(/[^0-9.]/g, "");
    const parts = raw.split(".");
    const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
    const max = Math.max(0, Number(item.quantity) - Number(item.refundedQuantity || 0));
    const n = Number(cleaned);
    const tolerance = 0.001;
    const snappedToMax = cleaned && Number.isFinite(n) && n > max && n <= max + tolerance;
    const normalized = snappedToMax ? String(max) : cleaned;
    const normalizedNumber = Number(normalized);
    if (normalized && (!Number.isFinite(normalizedNumber) || normalizedNumber < 0 || normalizedNumber > max + 1e-9)) return;
    if (snappedToMax) {
      setExactAll(q => ({ ...q, [item.id]: max }));
      setQuantities(q => ({ ...q, [item.id]: formatWeight(max) }));
    } else {
      setExactAll(q => { const next = { ...q }; delete next[item.id]; return next; });
      setQuantities(q => ({ ...q, [item.id]: normalized }));
    }
    if (item.unit === "kg") setAmounts(a => ({ ...a, [item.id]: normalized ? formatAmount(normalizedNumber * effectivePrice(item)) : "" }));
    setError("");
  };

  const setAmount = (item, value) => {
    const raw = String(value ?? "").replace(/[^0-9.]/g, "");
    const parts = raw.split(".");
    const cleaned = parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : raw;
    const amount = Number(cleaned);
    const maxAmount = Math.max(0, (Number(item.quantity) - Number(item.refundedQuantity || 0)) * effectivePrice(item));
    if (cleaned && (!Number.isFinite(amount) || amount < 0 || amount > maxAmount + 0.005)) return;
    const quantity = cleaned ? amount / effectivePrice(item) : 0;
    const max = Math.max(0, Number(item.quantity) - Number(item.refundedQuantity || 0));
    setExactAll(q => { const next = { ...q }; delete next[item.id]; return next; });
    setAmounts(a => ({ ...a, [item.id]: cleaned }));
    setQuantities(q => ({ ...q, [item.id]: quantity > max ? String(max) : String(quantity) }));
    setError("");
  };

  const switchMode = (item, mode) => {
    setModes(m => ({ ...m, [item.id]: mode }));
    if (mode === "amount") {
      const quantity = exactAll[item.id] != null ? exactAll[item.id] : Number(quantities[item.id] || 0);
      setAmounts(a => ({ ...a, [item.id]: quantity > 0 ? formatAmount(quantity * effectivePrice(item)) : "" }));
    } else {
      const amount = Number(amounts[item.id] || 0);
      const quantity = amount > 0 ? amount / effectivePrice(item) : (exactAll[item.id] != null ? exactAll[item.id] : Number(quantities[item.id] || 0));
      setQuantities(q => ({ ...q, [item.id]: quantity > 0 ? formatWeight(quantity) : "" }));
    }
  };

  const setItemToAll = item => {
    const remaining = Math.max(0, Number(item.quantity) - Number(item.refundedQuantity || 0));
    setExactAll(q => ({ ...q, [item.id]: remaining }));
    setQuantities(q => ({ ...q, [item.id]: formatWeight(remaining) }));
    if (item.unit === "kg") setAmounts(a => ({ ...a, [item.id]: formatAmount(remaining * effectivePrice(item)) }));
    setError("");
  };

  const selectAll = () => {
    const nextExact = {};
    const nextQty = {};
    const nextAmounts = {};
    (transaction.items || []).forEach(item => {
      const remaining = Math.max(0, Number(item.quantity) - Number(item.refundedQuantity || 0));
      if (item.unit === "kg") {
        nextExact[item.id] = remaining;
        nextQty[item.id] = formatWeight(remaining);
        nextAmounts[item.id] = formatAmount(remaining * effectivePrice(item));
      } else {
        nextQty[item.id] = String(remaining);
      }
    });
    setExactAll(nextExact);
    setQuantities(nextQty);
    setAmounts(nextAmounts);
    setError("");
  };

  const submit = () => {
    if (!selected.length || refundAmount <= 0) { setError("Select at least one quantity to refund."); return; }
    onContinue(selected.map(i => ({ transactionItemId: i.id, quantity: i.selected })));
  };

  return <div className="modal-backdrop" onMouseDown={onCancel}><div className="modal pop-in refund-selection-modal" onMouseDown={e => e.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow">CUSTOMER REFUND</div><h2>Refund Items</h2><p>{transaction.transactionNumber} · Choose the quantity to refund.</p></div><button className="icon-btn" onClick={onCancel}>×</button></div>
    <div className="refund-selection-tools"><span>Available quantities</span><button type="button" className="secondary small-btn" onClick={selectAll}>Select All</button></div>
    <div className="refund-item-list">{transaction.items.map(item => {
      const remaining = Math.max(0, Number(item.quantity) - Number(item.refundedQuantity || 0));
      const disabled = remaining <= 0;
      const mode = modes[item.id] || "weight";
      const selectedQty = exactAll[item.id] != null ? exactAll[item.id] : Number(quantities[item.id] || 0);
      const estimatedItemRefund = selectedQty * effectivePrice(item);
      return <div className={`refund-item-row ${disabled ? "refund-item-disabled" : ""}`} key={item.id}>
        <div className="refund-item-main"><strong>{item.name}</strong><small>{item.priceType} · {qtyText(item)} · {peso(item.unitPrice)}/{item.unit}</small>{Number(item.refundedQuantity || 0) > 0 && <small className="refund-item-note">Already refunded: {Number(item.refundedQuantity).toFixed(item.unit === "kg" ? 3 : 0)} {item.unit === "kg" ? "kg" : "pc"}</small>}</div>
        <div className="refund-item-right">
          <small>Remaining: {item.unit === "kg" ? remaining.toFixed(3) : remaining} {item.unit === "kg" ? "kg" : "pc"}</small>
          {item.unit === "kg" && <div className="refund-mode-toggle"><button type="button" className={mode === "weight" ? "active" : ""} onClick={() => switchMode(item, "weight")} disabled={disabled}>kg</button><button type="button" className={mode === "amount" ? "active" : ""} onClick={() => switchMode(item, "amount")} disabled={disabled}>₱</button></div>}
          <div className="refund-qty-controls">
            <div className="refund-input-wrap">{item.unit === "kg" && mode === "amount" && <span>₱</span>}<input className="text-input refund-qty-input" inputMode="decimal" value={item.unit === "kg" && mode === "amount" ? (amounts[item.id] || "") : (quantities[item.id] || "")} onChange={e => item.unit === "kg" && mode === "amount" ? setAmount(item, e.target.value) : setWeight(item, e.target.value)} placeholder={item.unit === "kg" && mode === "amount" ? "0.00" : "0.000"} disabled={disabled} /></div>
            <button type="button" className="refund-all-btn" onClick={() => setItemToAll(item)} disabled={disabled}>All</button>
          </div>
          {item.unit === "kg" && selectedQty > 0 && <small className="refund-item-estimate">≈ {peso(estimatedItemRefund)} refund</small>}
        </div>
      </div>;
    })}</div>
    {error && <div className="field-error">{error}</div>}
    <div className="refund-total-box"><span>Estimated refund</span><strong>{peso(refundAmount)}</strong><small>Weight entries display to 3 decimals. For kg products, switch to ₱ to enter the refund amount directly; the POS calculates the weight.</small></div>
    <div className="form-actions"><button type="button" className="secondary" onClick={onCancel}>Cancel</button><button type="button" className="danger" onClick={submit} disabled={!selected.length}>Continue to Refund</button></div>
  </div></div>;
}

function History({ transactions, total, page, totalPages, loading, filters, onFiltersChange, onRefresh, onHome, onRequestRefund, storeInfo, receiptSettings }) {
  const [selected, setSelected] = useState(null);
  const [refundSelection, setRefundSelection] = useState(null);
  const updateFilter = (key, value) => onFiltersChange({ ...filters, [key]: value, ...(key !== "page" ? { page: 1 } : {}) });
  const closeReceipt = () => setSelected(null);
  return <main className="simple-page">
    <header className="topbar"><button className="back" onClick={onHome}>← Home</button><div className="top-title"><BrandLogo storeInfo={storeInfo} className="mini-logo" /><h1>Transaction History</h1></div><button className="refresh" onClick={onRefresh}>↻ Refresh</button></header>
    <div className="history-wrap">
      <div className="history-head"><div><div className="eyebrow">SALES</div><h2>Transaction History</h2><p>Search and browse completed sales saved in your local database.</p></div><div className="history-count">{total} record{total !== 1 ? "s" : ""}</div></div>
      <div className="history-tools">
        <div className="history-search"><span>⌕</span><input className="search" value={filters.q} onChange={e => updateFilter("q", e.target.value)} placeholder="Search receipt or product..." /></div>
        <div className="history-presets">{[["all","All"],["today","Today"],["yesterday","Yesterday"],["7days","Last 7 days"],["month","This month"]].map(([v,label]) => <button key={v} className={filters.date === v ? "active" : ""} onClick={() => updateFilter("date", v)}>{label}</button>)}</div>
      </div>
      {loading ? <div className="loading">Loading transactions...</div> : !transactions.length ? <div className="placeholder"><div className="placeholder-icon">⌕</div><h2>No matching transactions</h2><p>Try another receipt number, product name, or date range.</p></div> : <>
        <div className="transaction-list">{transactions.map(tx => <button className={`transaction-row ${tx.refundedAt ? "refunded-row" : ""}`} key={tx.id} onClick={() => setSelected(tx)}>
          <div className="tx-number"><strong>{tx.transactionNumber}</strong><small>{new Date(tx.createdAt.replace(" ","T")).toLocaleString()}{tx.cashierName ? ` · ${tx.cashierName}` : ""}</small></div>
          <div className="tx-items">{tx.items.length} item{tx.items.length !== 1 ? "s" : ""}</div>
          {tx.refundStatus === "full" || tx.refundedAt ? <div className="refund-badge">REFUNDED</div> : tx.refundStatus === "partial" ? <div className="refund-badge partial">PARTIAL REFUND</div> : tx.discount > 0 && <div className="tx-discount">−{peso(tx.discount)}</div>}
          <strong className={`tx-total ${tx.refundStatus === "full" || tx.refundedAt ? "refunded-total" : ""}`}>{peso(Math.max(0, Number(tx.total) - Number(tx.refundedAmount || 0)))}</strong><span>→</span>
        </button>)}</div>
        <div className="history-pagination"><span>Showing {(page - 1) * filters.limit + 1}–{Math.min(page * filters.limit, total)} of {total}</span><div><button className="page-btn" disabled={page <= 1} onClick={() => updateFilter("page", page - 1)}>← Previous</button><span className="page-number">Page {page} of {totalPages}</span><button className="page-btn" disabled={page >= totalPages} onClick={() => updateFilter("page", page + 1)}>Next →</button></div></div>
      </>}
    </div>
    {selected && <div className="modal-backdrop" onMouseDown={closeReceipt}><div className="modal pop-in receipt-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modal-head"><div><div className="eyebrow">RECEIPT</div><h2>{selected.transactionNumber}</h2></div><button className="icon-btn" onClick={closeReceipt}>×</button></div>
      <ReceiptView sale={selected} storeInfo={storeInfo} receiptSettings={receiptSettings} />
      <div className="form-actions"><button className="secondary" onClick={()=>printDigitalReceipt(selected,storeInfo,receiptSettings)}>⎙ Print Receipt</button>{selected.refundStatus !== "full" && !selected.refundedAt && <button className="danger" onClick={() => setRefundSelection(selected)}>↩ Refund Items</button>}</div>
    </div></div>}
    {refundSelection && <RefundSelectionModal transaction={refundSelection} onCancel={() => setRefundSelection(null)} onContinue={items => { setRefundSelection(null); setSelected(null); onRequestRefund(refundSelection, items); }} />}
  </main>;
}

function formatDateShort(value) {
  const d = new Date(`${value}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ProductPerformanceModal({ data, loading, granularity, onGranularityChange, onClose }) {
  const product = data?.product || {};
  const summary = data?.summary || {};
  const series = data?.series || [];
  const maxSales = Math.max(1, ...series.map(x => Number(x.sales) || 0));
  const points = series.map((x, i) => {
    const px = series.length <= 1 ? 50 : (i / (series.length - 1)) * 100;
    const py = 100 - ((Number(x.sales) || 0) / maxSales) * 82 - 8;
    return `${px},${py}`;
  }).join(" ");
  const margin = Number(summary.sales) ? (Number(summary.grossProfit || 0) / Number(summary.sales)) * 100 : 0;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal pop-in product-performance-modal" onMouseDown={e=>e.stopPropagation()}>
    <div className="modal-head"><div><div className="eyebrow">PRODUCT PERFORMANCE</div><h2>{product.name || "Product"}</h2><p>Sales performance excluding refunded transactions.</p></div><button className="icon-btn" onClick={onClose}>×</button></div>
    <div className="period-control performance-period">{["daily","weekly","monthly","yearly"].map(g => <button key={g} className={granularity===g?"active":""} onClick={()=>onGranularityChange(g)}>{g[0].toUpperCase()+g.slice(1)}</button>)}</div>
    {loading ? <div className="loading">Loading product performance...</div> : <>
      <div className="product-performance-metrics">
        <div><span>Sales</span><strong>{peso(summary.sales)}</strong></div>
        <div><span>Quantity sold</span><strong>{Number(summary.quantity || 0).toFixed(product.unit === "kg" ? 2 : 0)} {product.unit === "kg" ? "kg" : "pc"}</strong></div>
        <div><span>Transactions</span><strong>{Number(summary.transactions || 0).toLocaleString()}</strong></div>
        <div><span>Gross profit</span><strong>{peso(summary.grossProfit)}</strong><small>{margin.toFixed(1)}% margin</small></div>
      </div>
      <section className="dashboard-card embedded-performance"><div className="card-head"><div><div className="eyebrow">TREND</div><h3>Sales performance</h3></div><strong>{series.length ? peso(series.reduce((a,x)=>a+Number(x.sales||0),0)) : peso(0)}</strong></div>
        {series.length ? <div className="sales-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Product sales trend"><polyline className="chart-area" points={`0,100 ${points} 100,100`} /><polyline className="chart-line" points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg><div className="chart-labels"><span>{series[0].bucket}</span><span>{series[Math.floor((series.length-1)/2)].bucket}</span><span>{series[series.length-1].bucket}</span></div></div> : <div className="chart-empty">No sales recorded for this period.</div>}
      </section>
      <div className="performance-detail-grid"><div className="performance-detail"><span>COGS</span><strong>{peso(summary.cogs)}</strong></div><div className="performance-detail"><span>Average sale</span><strong>{peso(summary.transactions ? Number(summary.sales)/Number(summary.transactions) : 0)}</strong></div><div className="performance-detail"><span>Retail sales</span><strong>{peso((data.priceTypes||[]).find(x=>x.priceType==="retail")?.sales || 0)}</strong></div><div className="performance-detail"><span>Wholesale sales</span><strong>{peso((data.priceTypes||[]).find(x=>x.priceType==="wholesale")?.sales || 0)}</strong></div></div>
    </>}
    <div className="form-actions"><button className="secondary" onClick={onClose}>Close</button></div>
  </div></div>;
}

function Dashboard({ data, loading, onRefresh, onDaysChange, onHome, onAddExpense, onDeleteExpense, salesSeries, salesGranularity, onSalesGranularityChange, topProducts, topProductsPeriod, onTopProductsPeriodChange, performanceProducts, performanceLoading, performanceSearch, onPerformanceSearchChange, onProductSelect, storeInfo }) {
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [pendingExpense, setPendingExpense] = useState(null);
  const [expenseBusy, setExpenseBusy] = useState(false);
  const metrics = data?.metrics || { netSales:0, grossSales:0, discounts:0, transactions:0, averageSale:0, cogs:0, grossProfit:0, expenses:0, netProfit:0, margin:0 };
  const series = salesSeries || [];
  const maxSales = Math.max(1, ...series.map(x => Number(x.sales) || 0));
  const points = series.map((x, i) => {
    const px = series.length <= 1 ? 50 : (i / (series.length - 1)) * 100;
    const py = 100 - ((Number(x.sales) || 0) / maxSales) * 86 - 7;
    return `${px},${py}`;
  }).join(" ");
  const previousSales = Number(data?.previous?.netSales || 0);
  const salesDelta = previousSales ? ((Number(metrics.netSales) - previousSales) / previousSales) * 100 : null;
  const submitExpense = async expense => { setExpenseBusy(true); try { await onAddExpense(expense); setExpenseOpen(false); } finally { setExpenseBusy(false); } };
  const removeExpense = async expense => { setExpenseBusy(true); try { await onDeleteExpense(expense); setPendingExpense(null); } finally { setExpenseBusy(false); } };
  return <main className="simple-page dashboard-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="top-title"><BrandLogo storeInfo={storeInfo} className="mini-logo" /><h1>Business Dashboard</h1></div><button className="refresh" onClick={onRefresh}>↻ Refresh</button></header>
    <div className="dashboard-wrap">
      <div className="dashboard-head"><div><div className="eyebrow">OWNER / ADMIN</div><h2>Business Overview</h2><p>Track sales, costs, profit and product performance.</p></div><div className="period-control">{[7,30,90,365].map(d => <button key={d} className={data?.days === d ? "active" : ""} onClick={() => onDaysChange(d)}>{d === 365 ? "1 year" : `${d} days`}</button>)}</div></div>
      {loading ? <div className="loading">Loading business data...</div> : <>
        <div className="metric-grid">
          <div className="metric-card"><span>Net Sales</span><strong>{peso(metrics.netSales)}</strong><small>{salesDelta === null ? "No previous-period comparison" : `${salesDelta >= 0 ? "↑" : "↓"} ${Math.abs(salesDelta).toFixed(1)}% vs previous period`}</small></div>
          <div className="metric-card"><span>Gross Profit</span><strong>{peso(metrics.grossProfit)}</strong><small>{Number(metrics.margin).toFixed(1)}% gross margin</small></div>
          <div className="metric-card"><span>Net Profit</span><strong>{peso(metrics.netProfit)}</strong><small>After recorded expenses</small></div>
          <div className="metric-card"><span>Transactions</span><strong>{Number(metrics.transactions).toLocaleString()}</strong><small>Avg. sale {peso(metrics.averageSale)}</small></div>
          <div className="metric-card compact"><span>COGS</span><strong>{peso(metrics.cogs)}</strong><small>Estimated product cost</small></div>
          <div className="metric-card compact"><span>Discounts</span><strong>{peso(metrics.discounts)}</strong><small>Discounts given</small></div>
        </div>
        {Number(data?.unknownCostItems || 0) > 0 && <div className="dashboard-warning">⚠ {data.unknownCostItems} sold item{data.unknownCostItems !== 1 ? "s" : ""} have no cost price recorded. Gross/net profit may be understated until product costs are entered.</div>}
        <div className="dashboard-grid">
          <section className="dashboard-card sales-chart-card"><div className="card-head"><div><div className="eyebrow">TREND</div><h3>Sales over time</h3><p className="card-subtitle">Choose how the sales trend is grouped.</p></div><strong>{peso(metrics.netSales)}</strong></div><div className="analytics-control-row"><span>View by</span><div className="period-control chart-period-control">{["daily","weekly","monthly","yearly"].map(g => <button type="button" key={g} className={salesGranularity===g?"active":""} onClick={()=>onSalesGranularityChange(g)}>{g[0].toUpperCase()+g.slice(1)}</button>)}</div></div>{series.length ? <div className="sales-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Sales trend"><polyline className="chart-area" points={`0,100 ${points} 100,100`} /><polyline className="chart-line" points={points} fill="none" vectorEffect="non-scaling-stroke" /></svg><div className="chart-labels"><span>{series[0].bucket}</span><span>{series[Math.floor((series.length-1)/2)].bucket}</span><span>{series[series.length-1].bucket}</span></div></div> : <div className="chart-empty">No sales recorded for this period.</div>}</section>
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">PRODUCTS</div><h3>Top products by sales</h3><p className="card-subtitle">Click a product to see its performance.</p></div></div><div className="analytics-control-row"><span>Period</span><div className="period-control chart-period-control">{[{key:"daily",label:"Daily"},{key:"weekly",label:"Weekly"},{key:"monthly",label:"Monthly"},{key:"yearly",label:"Yearly"}].map(x => <button type="button" key={x.key} className={topProductsPeriod===x.key?"active":""} onClick={()=>onTopProductsPeriodChange(x.key)}>{x.label}</button>)}</div></div><div className="top-products">{(topProducts || []).length ? topProducts.slice(0,10).map((p,i) => <button type="button" className="top-product top-product-button" key={`${p.productId}-${p.name}-${i}`} onClick={()=>onProductSelect(p)}><div className="rank">{i+1}</div><div className="top-product-main"><strong>{p.name}</strong><small>{Number(p.quantity).toFixed(p.unit === "kg" ? 2 : 0)} {p.unit === "kg" ? "kg" : "pc"} sold · {Number(p.grossProfit)>=0?peso(p.grossProfit):"− "+peso(Math.abs(p.grossProfit))} gross profit</small></div><strong>{peso(p.sales)}</strong><span className="top-product-arrow">→</span></button>) : <div className="chart-empty">No product sales for this period.</div>}</div><div className="product-list-note">Showing top 10 products for this period. Click any product for a detailed performance report.</div></section>
        </div>
        <section className="dashboard-card product-performance-list-card"><div className="card-head"><div><div className="eyebrow">PRODUCT PERFORMANCE</div><h3>All Product Performance</h3><p className="card-subtitle">Search any product and click it for a detailed sales report.</p></div><div className="history-search performance-search"><span>⌕</span><input className="search" value={performanceSearch} onChange={e=>onPerformanceSearchChange(e.target.value)} placeholder="Search products..." /></div></div><div className="analytics-control-row"><span>Period</span><div className="period-control chart-period-control">{[{key:"daily",label:"Daily"},{key:"weekly",label:"Weekly"},{key:"monthly",label:"Monthly"},{key:"yearly",label:"Yearly"}].map(x=><button type="button" key={x.key} className={topProductsPeriod===x.key?"active":""} onClick={()=>onTopProductsPeriodChange(x.key)}>{x.label}</button>)}</div></div>{performanceLoading ? <div className="loading compact-loading">Loading product performance...</div> : <div className="product-performance-grid">{(performanceProducts || []).length ? performanceProducts.map(p=><button type="button" className="product-performance-card" key={`all-performance-${p.productId}`} onClick={()=>onProductSelect(p)}><div className="product-performance-card-head"><strong>{p.name}</strong>{p.isDeleted && <span className="product-deleted-label">Deleted</span>}</div><small>{p.unit === "kg" ? "Kilogram" : "Piece"} · {Number(p.quantity).toFixed(p.unit === "kg" ? 2 : 0)} sold · {Number(p.transactions||0).toLocaleString()} transactions</small><div className="product-performance-card-stats"><span>Sales<strong>{peso(p.sales)}</strong></span><span>Profit<strong>{peso(p.grossProfit)}</strong></span></div></button>) : <div className="chart-empty">No products match your search.</div>}</div>}</section>
        <div className="dashboard-grid lower">
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">ACCOUNTING</div><h3>Profit breakdown</h3></div></div><div className="breakdown"><div><span>Gross sales</span><strong>{peso(metrics.grossSales)}</strong></div><div><span>Discounts</span><strong>− {peso(metrics.discounts)}</strong></div><div><span>Net sales</span><strong>{peso(metrics.netSales)}</strong></div><div><span>Cost of goods sold</span><strong>− {peso(metrics.cogs)}</strong></div><div className="emphasis"><span>Gross profit</span><strong>{peso(metrics.grossProfit)}</strong></div><div><span>Operating expenses</span><strong>− {peso(metrics.expenses)}</strong></div><div className="emphasis final"><span>Net profit</span><strong>{peso(metrics.netProfit)}</strong></div></div></section>
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">EXPENSES</div><h3>Operating expenses</h3></div><button className="primary small-btn" onClick={() => setExpenseOpen(true)}>＋ Add Expense</button></div>{(data.expenses || []).length ? <div className="expense-list">{data.expenses.map(e => <div className="expense-row" key={e.id}><div><strong>{e.description}</strong><small>{e.date} · {e.category}</small></div><div className="expense-right"><strong>{peso(e.amount)}</strong><button className="icon-danger" onClick={() => setPendingExpense(e)}>×</button></div></div>)}</div> : <div className="chart-empty">No expenses recorded for this period.</div>}</section>
        </div>
      </>}
    </div>
    {expenseOpen && <ExpenseForm onSave={submitExpense} busy={expenseBusy} onClose={() => !expenseBusy && setExpenseOpen(false)} />}
    {pendingExpense && <ConfirmModal title="Delete expense?" message={`Delete “${pendingExpense.description}” (${peso(pendingExpense.amount)}) from the records?`} confirmLabel="Delete Expense" busyLabel="Deleting..." onCancel={() => !expenseBusy && setPendingExpense(null)} onConfirm={() => removeExpense(pendingExpense)} busy={expenseBusy} />}
  </main>;
}

function ExpenseForm({ onSave, onClose, busy }) {
  const today = new Date().toISOString().slice(0,10);
  const [form,setForm] = useState({date:today,category:"General",description:"",amount:""});
  const [errors,setErrors] = useState({});
  const set=(k,v)=>{setForm(f=>({...f,[k]:v}));setErrors(e=>({...e,[k]:""}))};
  const submit=async e=>{e.preventDefault();const er={};if(!form.date)er.date="Date is required.";if(!form.category.trim())er.category="Category is required.";if(!form.description.trim())er.description="Description is required.";if(!String(form.amount).trim())er.amount="Enter the expense amount.";else if(!Number.isFinite(Number(form.amount))||Number(form.amount)<=0)er.amount="Enter an amount greater than 0.";setErrors(er);if(Object.keys(er).length)return;await onSave({...form,amount:Number(form.amount)})};
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal pop-in" onSubmit={submit} onMouseDown={e=>e.stopPropagation()}><div className="modal-head"><div><div className="eyebrow">ACCOUNTING</div><h2>Add Expense</h2><p>Record a business expense for profit tracking.</p></div><button type="button" className="icon-btn" onClick={onClose}>×</button></div><label className="label">Date</label><input type="date" className={`text-input ${errors.date?"field-invalid":""}`} value={form.date} onChange={e=>set("date",e.target.value)}/>{errors.date&&<div className="field-error">{errors.date}</div>}<label className="label">Category</label><select className={`text-input ${errors.category?"field-invalid":""}`} value={form.category} onChange={e=>set("category",e.target.value)}><option>General</option><option>Rent</option><option>Utilities</option><option>Transportation</option><option>Supplies</option><option>Wages</option><option>Repairs</option><option>Other</option></select>{errors.category&&<div className="field-error">{errors.category}</div>}<label className="label">Description</label><input className={`text-input ${errors.description?"field-invalid":""}`} value={form.description} onChange={e=>set("description",e.target.value)} placeholder="e.g. Electricity bill"/>{errors.description&&<div className="field-error">{errors.description}</div>}<label className="label">Amount</label><NumericField value={form.amount} onChange={v=>set("amount",v)} placeholder="0.00" prefix="₱" className={errors.amount?"field-invalid":""}/>{errors.amount&&<div className="field-error">{errors.amount}</div>}<div className="form-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy?"Saving...":"Save Expense"}</button></div></form></div>;
}

function Products({ products, categories, loading, onRefresh, onSave, onDelete, onSaveCategory, onHome, storeInfo }) {
  const [editing, setEditing] = useState(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [showDeleted, setShowDeleted] = useState(false);
  const filtered = products.filter(p => (showDeleted ? p.isDeleted : !p.isDeleted) && (category === "All" || p.category === category) && p.name.toLowerCase().includes(search.toLowerCase()));

  const toggle = async product => {
    await onSave({ ...product, isAvailable: !product.isAvailable, categoryId: product.categoryId });
  };

  return <main className="simple-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="top-title"><BrandLogo storeInfo={storeInfo} className="mini-logo" /><h1>Manage Products</h1></div><div className="top-actions"><button className="secondary small-btn" onClick={() => setAddingCategory(true)}>＋ Category</button><button className="primary small-btn" onClick={() => setEditing({ name:"", barcode:"", unit:"kg", retail:"", wholesale:"", costPrice:"", emoji:"🛒", imageData:"", categoryId:"" })}>＋ Add Product</button></div></header>
    <div className="products-wrap">
      <div className="catalog-head manage-head"><div><div className="eyebrow">CATALOG</div><h2>Products & Prices</h2><p>These products are stored in SQLite.</p></div><div className="search-wrap"><span>⌕</span><input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." /></div></div>
      <div className="manage-filters"><div className="categories">{["All", ...categories.map(c => c.name)].map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div><button className={`deleted-filter ${showDeleted ? "active" : ""}`} onClick={() => setShowDeleted(v => !v)}>{showDeleted ? "Showing deleted" : "Show deleted"}</button></div>
      {loading ? <div className="loading">Loading products...</div> : <div className="manage-grid">{filtered.map(p => <div className={`manage-card ${!p.isAvailable ? "disabled-product" : ""} ${p.isDeleted ? "deleted-product" : ""}`} key={p.id}>
        <div className="manage-emoji">{p.imageData ? <img src={p.imageData} alt="" /> : <span>{p.emoji}</span>}</div><div className="manage-main"><strong>{p.name}</strong><small>{p.category} · {p.unit === "kg" ? "kilogram" : "piece"}{p.barcode ? ` · Barcode: ${p.barcode}` : ""}</small><div className="price-pair"><span>Retail <b>{peso(p.retail)}</b></span><span>Wholesale <b>{peso(p.wholesale)}</b></span><span>Cost <b>{peso(p.costPrice)}</b></span></div></div>
        <div className="manage-actions"><button onClick={() => setEditing(p)}>Edit</button>{!p.isDeleted && <button onClick={() => toggle(p)}>{p.isAvailable ? "Disable" : "Enable"}</button>}</div>
      </div>)}</div>}
    </div>
    {editing && <ProductForm initial={editing} categories={categories} onSave={onSave} onDelete={onDelete} onClose={() => setEditing(null)} />}
    {addingCategory && <CategoryForm onSave={onSaveCategory} onClose={() => setAddingCategory(false)} />}
  </main>;
}


function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadReportCSV(data, filters) {
  if (!data) return;
  const m = data.metrics || {};
  const rows = [
    ["GROCERY POS SALES REPORT"],
    ["Period", `${filters.start} to ${filters.end}`],
    [],
    ["SUMMARY"],
    ["Metric", "Value"],
    ["Gross Sales", Number(m.grossSales || 0).toFixed(2)],
    ["Discounts", Number(m.discounts || 0).toFixed(2)],
    ["Refunds", Number(m.refunds || 0).toFixed(2)],
    ["Net Sales", Number(m.netSales || 0).toFixed(2)],
    ["COGS", Number(m.cogs || 0).toFixed(2)],
    ["Gross Profit", Number(m.grossProfit || 0).toFixed(2)],
    ["Expenses", Number(m.expenses || 0).toFixed(2)],
    ["Net Profit", Number(m.netProfit || 0).toFixed(2)],
    ["Transactions", Number(m.transactions || 0)],
    ["Average Sale", Number(m.averageSale || 0).toFixed(2)],
    ["Refund Events", Number(m.refundEvents || 0)],
    ["Full Refunds", Number(m.fullRefunds || 0)],
    ["Partial Refunds", Number(m.partialRefunds || 0)],
    [],
    ["DAILY SALES"],
    ["Date", "Transactions", "Gross Sales", "Refunds", "Net Sales"],
    ...(data.daily || []).map(r => [r.date, r.transactions, Number(r.grossSales || 0).toFixed(2), Number(r.refunds || 0).toFixed(2), Number(r.netSales || 0).toFixed(2)]),
    [],
    ["RETAIL VS WHOLESALE"],
    ["Price Type", "Quantity", "Unit", "Sales"],
    ...(data.priceTypes || []).map(r => [r.priceType === "retail" ? "Retail" : "Wholesale", Number(r.quantity || 0), r.unit || "", Number(r.sales || 0).toFixed(2)]),
    [],
    ["SALES BY CATEGORY"],
    ["Category", "Transactions", "Sales"],
    ...(data.categories || []).map(r => [r.category, r.transactions, Number(r.sales || 0).toFixed(2)]),
    [],
    ["PRODUCTS BY NET SALES"],
    ["Product", "Unit", "Quantity", "Transactions", "Net Sales", "COGS", "Gross Profit"],
    ...(data.products || []).map(r => [r.name, r.unit, Number(r.quantity || 0), r.transactions, Number(r.sales || 0).toFixed(2), Number(r.cogs || 0).toFixed(2), Number(r.grossProfit || 0).toFixed(2)])
  ];
  const csv = "\\ufeff" + rows.map(row => row.map(csvEscape).join(",")).join("\\r\\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sales-report-${filters.start}-to-${filters.end}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function printSalesReport(data, filters) {
  if (!data) return;
  const w = window.open("", "_blank", "width=1000,height=800");
  if (!w) { alert("Please allow pop-ups to print the report."); return; }
  const esc = value => String(value ?? "").replace(/[&<>\"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[ch]));
  const money = value => `₱${Number(value || 0).toFixed(2)}`;
  const m = data.metrics || {};
  const daily = (data.daily || []).map(r => `<tr><td>${esc(r.date)}</td><td>${r.transactions}</td><td>${money(r.grossSales)}</td><td>${money(r.refunds)}</td><td><strong>${money(r.netSales)}</strong></td></tr>`).join("");
  const categories = (data.categories || []).map(r => `<tr><td>${esc(r.category)}</td><td>${r.transactions}</td><td><strong>${money(r.sales)}</strong></td></tr>`).join("");
  const products = (data.products || []).map(r => `<tr><td>${esc(r.name)}</td><td>${esc(r.unit)}</td><td>${Number(r.quantity || 0).toFixed(r.unit === "kg" ? 3 : 0)}</td><td>${r.transactions}</td><td>${money(r.sales)}</td><td>${money(r.cogs)}</td><td><strong>${money(r.grossProfit)}</strong></td></tr>`).join("");
  const priceTypes = (data.priceTypes || []).map(r => `<tr><td>${r.priceType === "retail" ? "Retail" : "Wholesale"}</td><td>${Number(r.quantity || 0).toFixed(r.unit === "kg" ? 3 : 0)} ${r.unit === "kg" ? "kg" : "pcs"}</td><td><strong>${money(r.sales)}</strong></td></tr>`).join("");
  w.document.write(`<!doctype html><html><head><title>Sales Report ${esc(filters.start)} to ${esc(filters.end)}</title><style>
  @page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#26342c;font-size:10px;margin:0}h1{font-size:22px;margin:0 0 4px}h2{font-size:14px;margin:22px 0 8px;border-bottom:1px solid #d8e1da;padding-bottom:5px}p{margin:3px 0;color:#65736a}.period{font-weight:700;color:#26342c}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:14px}.metric{border:1px solid #dce5de;border-radius:7px;padding:8px}.metric span{display:block;color:#65736a;font-size:8px;text-transform:uppercase}.metric strong{display:block;font-size:13px;margin-top:3px}table{width:100%;border-collapse:collapse;margin-top:5px}th{text-align:left;background:#f1f5f2;color:#5f6d65;font-size:8px;text-transform:uppercase;padding:6px;border-bottom:1px solid #d9e1da}td{padding:6px;border-bottom:1px solid #e7ece8}td:not(:first-child){white-space:nowrap}.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}.footer{margin-top:24px;padding-top:8px;border-top:1px solid #dce5de;color:#748078;font-size:8px}@media print{.no-print{display:none!important}}
  </style></head><body><h1>Grocery POS — Sales Report</h1><p class="period">${esc(filters.start)} to ${esc(filters.end)}</p><p>Generated from the local POS sales records.</p>
  <div class="summary"><div class="metric"><span>Gross Sales</span><strong>${money(m.grossSales)}</strong></div><div class="metric"><span>Net Sales</span><strong>${money(m.netSales)}</strong></div><div class="metric"><span>Gross Profit</span><strong>${money(m.grossProfit)}</strong></div><div class="metric"><span>Net Profit</span><strong>${money(m.netProfit)}</strong></div><div class="metric"><span>Refunds</span><strong>${money(m.refunds)}</strong></div><div class="metric"><span>Discounts</span><strong>${money(m.discounts)}</strong></div><div class="metric"><span>Transactions</span><strong>${Number(m.transactions || 0).toLocaleString()}</strong></div><div class="metric"><span>Expenses</span><strong>${money(m.expenses)}</strong></div></div>
  <h2>Daily Sales</h2><table><thead><tr><th>Date</th><th>Transactions</th><th>Gross Sales</th><th>Refunds</th><th>Net Sales</th></tr></thead><tbody>${daily || '<tr><td colspan="5">No sales recorded for this period.</td></tr>'}</tbody></table>
  <div class="two"><section><h2>Retail vs Wholesale</h2><table><thead><tr><th>Price Type</th><th>Quantity</th><th>Sales</th></tr></thead><tbody>${priceTypes || '<tr><td colspan="3">No sales.</td></tr>'}</tbody></table></section><section><h2>Sales by Category</h2><table><thead><tr><th>Category</th><th>Transactions</th><th>Sales</th></tr></thead><tbody>${categories || '<tr><td colspan="3">No category sales.</td></tr>'}</tbody></table></section></div>
  <h2>Products by Net Sales</h2><table><thead><tr><th>Product</th><th>Unit</th><th>Qty</th><th>Transactions</th><th>Net Sales</th><th>COGS</th><th>Gross Profit</th></tr></thead><tbody>${products || '<tr><td colspan="7">No product sales.</td></tr>'}</tbody></table>
  <div class="footer">Refunds and discounts are reflected in the net sales figures. This report is generated locally by Grocery POS.</div><script>window.onload=()=>setTimeout(()=>window.print(),250);</script></body></html>`);
  w.document.close();
}

function SalesReports({ data, loading, filters, onFiltersChange, onRefresh, onHome, storeInfo }) {
  const metrics = data?.metrics || { grossSales:0, discounts:0, refunds:0, netSales:0, cogs:0, grossProfit:0, expenses:0, netProfit:0, transactions:0, averageSale:0 };
  const setFilter = (key, value) => onFiltersChange({ ...filters, [key]: value });
  return <main className="simple-page reports-page">
    <header className="topbar"><button className="back" onClick={onHome}><span className="back-arrow">←</span><span>Owner Center</span></button><div className="top-title"><BrandLogo storeInfo={storeInfo} className="mini-logo" /><h1>Sales Reports</h1></div><div className="report-header-actions"><button className="secondary report-tool-btn" onClick={() => downloadReportCSV(data, filters)} disabled={!data}>⇩ CSV</button><button className="secondary report-tool-btn" onClick={() => printSalesReport(data, filters)} disabled={!data}>⎙ Print</button><button className="refresh" onClick={onRefresh}>↻ Refresh</button></div></header>
    <div className="reports-wrap">
      <div className="reports-head"><div><div className="eyebrow">OWNER / ADMIN</div><h2>Sales Reports</h2><p>Detailed sales, refunds, discounts and profit for a selected date range.</p></div></div>
      <section className="dashboard-card report-filter-card">
        <div className="report-date-fields"><label><span>From</span><input type="date" value={filters.start} onChange={e=>setFilter("start",e.target.value)} /></label><label><span>To</span><input type="date" value={filters.end} onChange={e=>setFilter("end",e.target.value)} /></label><button className="primary report-apply" onClick={onRefresh}>Generate Report</button></div>
        <div className="history-presets report-presets">{[["today","Today"],["yesterday","Yesterday"],["week","This week"],["month","This month"],["year","This year"]].map(([k,l])=><button type="button" key={k} onClick={()=>{const now=new Date(); const pad=n=>String(n).padStart(2,"0"); const fmt=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; let a=new Date(now), b=new Date(now); if(k==="yesterday"){a.setDate(a.getDate()-1);b.setDate(b.getDate()-1)} if(k==="week"){const day=a.getDay(); a.setDate(a.getDate()-(day===0?6:day-1))} if(k==="month"){a=new Date(a.getFullYear(),a.getMonth(),1)} if(k==="year"){a=new Date(a.getFullYear(),0,1)} const next={start:fmt(a),end:fmt(b)}; onFiltersChange(next); onRefresh(next)}}>{l}</button>)}</div>
      </section>
      {loading ? <div className="loading">Generating report...</div> : <>
        <div className="metric-grid report-metrics">
          <div className="metric-card"><span>Gross Sales</span><strong>{peso(metrics.grossSales)}</strong><small>Before discounts and refunds</small></div>
          <div className="metric-card"><span>Net Sales</span><strong>{peso(metrics.netSales)}</strong><small>After discounts and refunds</small></div>
          <div className="metric-card"><span>Gross Profit</span><strong>{peso(metrics.grossProfit)}</strong><small>Sales less estimated COGS</small></div>
          <div className="metric-card"><span>Net Profit</span><strong>{peso(metrics.netProfit)}</strong><small>After recorded expenses</small></div>
          <div className="metric-card compact"><span>Refunds</span><strong>{peso(metrics.refunds)}</strong><small>Refunded value</small></div>
          <div className="metric-card compact"><span>Discounts</span><strong>{peso(metrics.discounts)}</strong><small>Discounts given</small></div>
          <div className="metric-card compact"><span>Transactions</span><strong>{Number(metrics.transactions).toLocaleString()}</strong><small>Average {peso(metrics.averageSale)}</small></div>
          <div className="metric-card compact"><span>Expenses</span><strong>{peso(metrics.expenses)}</strong><small>Recorded operating expenses</small></div>
        </div>
        {data.comparison && <section className="dashboard-card report-comparison-card">
          <div className="card-head"><div><div className="eyebrow">PERIOD COMPARISON</div><h3>Compared with previous period</h3><p className="card-subtitle">Previous period: {data.comparison.start} to {data.comparison.end}</p></div></div>
          <div className="report-comparison-grid">{[["Net Sales","netSales"],["Gross Profit","grossProfit"],["Net Profit","netProfit"],["Transactions","transactions"],["Refunds","refunds"],["Discounts","discounts"]].map(([label,key])=>{const cur=Number(metrics[key]||0), prev=Number(data.comparison.metrics[key]||0); const pct=prev===0 ? (cur===0?0:null) : ((cur-prev)/Math.abs(prev))*100; return <div className="report-comparison-item" key={key}><span>{label}</span><strong>{key==="transactions"?cur.toLocaleString():peso(cur)}</strong><small>{pct===null?"No previous-period baseline":`${pct>=0?"↑":"↓"} ${Math.abs(pct).toFixed(1)}% vs previous`}</small></div>})}</div>
        </section>}
        <div className="reports-grid">
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">DAILY SALES</div><h3>Sales by day</h3></div><strong>{peso(metrics.netSales)}</strong></div>{data.daily?.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Date</th><th>Transactions</th><th>Gross Sales</th><th>Refunds</th><th>Net Sales</th></tr></thead><tbody>{data.daily.map(r=><tr key={r.date}><td>{new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</td><td>{r.transactions}</td><td>{peso(r.grossSales)}</td><td>{r.refunds ? `−${peso(r.refunds)}` : peso(0)}</td><td><strong>{peso(r.netSales)}</strong></td></tr>)}</tbody></table></div> : <div className="chart-empty">No sales recorded for this date range.</div>}</section>
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">SALES MIX</div><h3>Retail vs wholesale</h3></div></div><div className="report-breakdown">{(data.priceTypes||[]).map(x=><div key={x.priceType}><span>{x.priceType === "retail" ? "Retail" : "Wholesale"}</span><strong>{peso(x.sales)}</strong><small>{Number(x.quantity).toFixed(x.unit === "kg" ? 2 : 0)} {x.unit === "kg" ? "kg" : "pcs"} sold</small></div>)}</div></section>
        </div>
        <div className="reports-grid">
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">CATEGORIES</div><h3>Sales by category</h3></div></div>{data.categories?.length ? <div className="report-category-list">{data.categories.map((x,i)=><div className="report-category-row" key={`${x.category}-${i}`}><span>{x.category}</span><strong>{peso(x.sales)}</strong><small>{x.transactions} transactions</small></div>)}</div> : <div className="chart-empty">No category sales in this period.</div>}</section>
          <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">REFUNDS</div><h3>Refund summary</h3></div><strong>{peso(metrics.refunds)}</strong></div><div className="report-refund-stats"><div><span>Refunded amount</span><strong>{peso(metrics.refunds)}</strong></div><div><span>Refund events</span><strong>{Number(metrics.refundEvents).toLocaleString()}</strong></div><div><span>Full refunds</span><strong>{Number(metrics.fullRefunds).toLocaleString()}</strong></div><div><span>Partial refunds</span><strong>{Number(metrics.partialRefunds).toLocaleString()}</strong></div></div></section>
        </div>
        <section className="dashboard-card"><div className="card-head"><div><div className="eyebrow">TOP PRODUCTS</div><h3>Products by net sales</h3><p className="card-subtitle">Refunded quantities are excluded.</p></div></div>{data.products?.length ? <div className="report-table-wrap"><table className="report-table"><thead><tr><th>Product</th><th>Quantity</th><th>Transactions</th><th>Net Sales</th><th>Gross Profit</th></tr></thead><tbody>{data.products.map((r,i)=><tr key={`${r.productId}-${i}`}><td><strong>{r.name}</strong></td><td>{Number(r.quantity).toFixed(r.unit === "kg" ? 2 : 0)} {r.unit === "kg" ? "kg" : "pc"}</td><td>{r.transactions}</td><td>{peso(r.sales)}</td><td>{peso(r.grossProfit)}</td></tr>)}</tbody></table></div> : <div className="chart-empty">No product sales in this date range.</div>}</section>
      </>}
    </div>
  </main>;
}

function App() {
  const [screen, setScreen] = useState("home");
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [historyMeta, setHistoryMeta] = useState({ total: 0, page: 1, totalPages: 1 });
  const [historyFilters, setHistoryFilters] = useState({ q: "", date: "all", page: 1, limit: 25 });
  const [dashboardData, setDashboardData] = useState(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const todayISO = new Date().toISOString().slice(0,10);
  const [reportFilters, setReportFilters] = useState({ start: todayISO, end: todayISO });
  const [reportData, setReportData] = useState(null);
  const [loadingReports, setLoadingReports] = useState(false);
  const [staffFilters, setStaffFilters] = useState({ start: todayISO, end: todayISO, staff: "all", page: 1, limit: 25 });
  const [staffData, setStaffData] = useState(null);
  const [loadingStaff, setLoadingStaff] = useState(false);
  const [auditFilters, setAuditFilters] = useState({ start: todayISO, end: todayISO, staff: "all", action: "all", q: "", page: 1, limit: 50 });
  const [auditData, setAuditData] = useState(null);
  const [debtFilters, setDebtFilters] = useState({ status:"all", supplier:"", q:"", page:1, limit:25 });
  const [debtData, setDebtData] = useState(null);
  const [loadingDebt, setLoadingDebt] = useState(false);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [salesSeries, setSalesSeries] = useState([]);
  const [salesGranularity, setSalesGranularity] = useState("daily");
  const [topProductsPeriod, setTopProductsPeriod] = useState("monthly");
  const [performanceProducts, setPerformanceProducts] = useState([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceSearch, setPerformanceSearch] = useState("");
  const [topProducts, setTopProducts] = useState([]);
  const [productPerformance, setProductPerformance] = useState(null);
  const [loadingProductPerformance, setLoadingProductPerformance] = useState(false);
  const [productCardSize, setProductCardSize] = useState(() => localStorage.getItem("pos-product-card-size") || "medium");
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deletingProduct, setDeletingProduct] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [cart, setCart] = useState([]);
  const [modalProduct, setModalProduct] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [discount, setDiscount] = useState(0);
  const [cash, setCash] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [completed, setCompleted] = useState(null);
  const [error, setError] = useState("");
  const [adminConfigured, setAdminConfigured] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [cashierToken, setCashierToken] = useState("");
  const [cashierUser, setCashierUser] = useState(null);
  const [cashierLoginOpen, setCashierLoginOpen] = useState(false);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPending, setAdminPending] = useState(null);
  const [adminSettings, setAdminSettings] = useState(null);
  const [loadingAdminSettings, setLoadingAdminSettings] = useState(false);
  const [storeInfo, setStoreInfo] = useState(null);
  const [loadingStoreInfo, setLoadingStoreInfo] = useState(false);
  const [receiptSettings, setReceiptSettings] = useState(DEFAULT_RECEIPT_SETTINGS);
  const [loadingReceiptSettings, setLoadingReceiptSettings] = useState(false);
  const [adminTimeoutMinutes, setAdminTimeoutMinutes] = useState(15);
  const adminLastActivityRef = useRef(0);
  const [pendingRefund, setPendingRefund] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => isPosSoundEnabled());

  const loadStoreInfo = async () => {
    setLoadingStoreInfo(true);
    try { const result = await api("/api/store-info"); setStoreInfo(result); return result; }
    finally { setLoadingStoreInfo(false); }
  };

  const saveStoreInfo = async data => {
    const result = await api("/api/store-info", { method:"PUT", body:JSON.stringify(data) }, adminToken);
    setStoreInfo(result);
    return result;
  };

  const loadReceiptSettings = async () => {
    setLoadingReceiptSettings(true);
    try { const result = await api("/api/receipt-settings"); setReceiptSettings({...DEFAULT_RECEIPT_SETTINGS,...result}); return result; }
    finally { setLoadingReceiptSettings(false); }
  };

  const saveReceiptSettings = async data => {
    const result = await api("/api/receipt-settings", { method:"PUT", body:JSON.stringify(data) }, adminToken);
    setReceiptSettings({...DEFAULT_RECEIPT_SETTINGS,...result});
    return result;
  };

  const loadStaff = async (override = {}) => {
    if (!adminToken) return;
    setLoadingStaff(true);
    try {
      const next = { ...staffFilters, ...override };
      const qs = new URLSearchParams({ start: next.start, end: next.end, staff: next.staff || "all", page: String(next.page || 1), limit: String(next.limit || 25) }).toString();
      const result = await api(`/api/staff-performance?${qs}`, {}, adminToken);
      setStaffData({ ...result, storeInfo });
      return result;
    } catch (e) { setError(e.message); if (e.message === "Admin authorization required.") { setAdminToken(""); setScreen("home"); } throw e; }
    finally { setLoadingStaff(false); }
  };

  const updateStaffFilters = updater => {
    setStaffFilters(prev => { const next = typeof updater === "function" ? updater(prev) : { ...prev, ...updater }; setTimeout(() => loadStaff(next).catch(()=>{}), 0); return next; });
  };
  const loadAudit = async (override = {}) => {
    if (!adminToken) return;
    setLoadingAudit(true);
    try { const next={...auditFilters,...override}; const qs=new URLSearchParams({start:next.start,end:next.end,staff:next.staff||"all",action:next.action||"all",q:next.q||"",page:String(next.page||1),limit:String(next.limit||50)}).toString(); const result=await api(`/api/audit-logs?${qs}`,{},adminToken); setAuditData(result); return result; }
    catch(e){ setError(e.message); if(e.message==="Admin authorization required."){setAdminToken("");setScreen("home");} throw e; }
    finally { setLoadingAudit(false); }
  };
  const updateAuditFilters = updater => { setAuditFilters(prev=>{const next=typeof updater==="function"?updater(prev):{...prev,...updater}; setTimeout(()=>loadAudit(next).catch(()=>{}),0); return next;}); };

  const loadDebts = async (override = {}) => { const f={...debtFilters,...override}; setLoadingDebt(true); try { const qs=new URLSearchParams({status:f.status||"all",supplier:f.supplier||"",q:f.q||"",page:String(f.page||1),limit:String(f.limit||25)}); const d=await api(`/api/debts?${qs.toString()}`,{},adminToken); setDebtData(d); return d; } finally { setLoadingDebt(false); } };
  const updateDebtFilters = next => { setDebtFilters(next); loadDebts(next); };
  const saveDebt = async form => { const body={supplierName:form.supplierName,debtDate:form.debtDate,notes:form.notes,items:form.items.map(x=>({quantity:String(x.quantity??"").trim(),description:x.description,cost:Number(x.cost)}))}; const result=await api(form.id?`/api/debts/${form.id}`:"/api/debts",{method:form.id?"PUT":"POST",body:JSON.stringify(body)},adminToken); await loadDebts(debtFilters); return result; };
  const deleteDebt = async id => { await api(`/api/debts/${id}`,{method:"DELETE"},adminToken); };
  const saveDebtPayment = async (id,form) => api(`/api/debts/${id}/payments`,{method:"POST",body:JSON.stringify({paymentDate:form.paymentDate,amount:Number(form.amount),notes:form.notes})},adminToken);
  const deleteDebtPayment = async (debtId,paymentId) => api(`/api/debts/${debtId}/payments/${paymentId}`,{method:"DELETE"},adminToken);
  const loadCashiers = async () => api("/api/cashiers", {}, adminToken);
  const saveCashier = async data => {
    const url = data.id ? `/api/cashiers/${data.id}` : "/api/cashiers";
    return api(url, { method: data.id ? "PUT" : "POST", body: JSON.stringify(data) }, adminToken);
  };
  const loginCashier = (token, cashier) => { setCashierToken(token); setCashierUser(cashier); setCashierLoginOpen(false); setScreen("home"); };
  const logoutCashier = async () => { try { await api("/api/cashier/logout", { method:"POST" }, "", cashierToken); } catch {} setCashierToken(""); setCashierUser(null); setScreen("home"); };

  const loadAdminSettings = async () => {
    if (!adminToken) return null;
    setLoadingAdminSettings(true);
    try {
      const result = await api("/api/auth/settings", {}, adminToken);
      setAdminSettings(result);
      setAdminTimeoutMinutes(Number.isFinite(Number(result.sessionTimeoutMinutes)) ? Number(result.sessionTimeoutMinutes) : 15);
      return result;
    } catch (e) {
      setError(e.message);
      if (e.message === "Admin authorization required.") {
        setAdminToken("");
        setAdminPending(null);
        setScreen("home");
      }
      throw e;
    } finally { setLoadingAdminSettings(false); }
  };

  const changeAdminPasscode = async data => {
    const result = await api("/api/auth/change-passcode", { method:"POST", body:JSON.stringify(data) }, adminToken);
    setAdminToken(result.token);
    adminLastActivityRef.current = Date.now();
    setError("");
  };

  const generateRecoveryCode = async () => {
    const result = await api("/api/auth/recovery-code", { method:"POST" }, adminToken);
    setAdminSettings(s => ({ ...(s || {}), hasRecoveryCode: true }));
    return result;
  };

  const changeAdminTimeout = async minutes => {
    const result = await api("/api/auth/settings", { method:"PUT", body:JSON.stringify({ sessionTimeoutMinutes: minutes }) }, adminToken);
    setAdminSettings(result);
    setAdminTimeoutMinutes(Number.isFinite(Number(result.sessionTimeoutMinutes)) ? Number(result.sessionTimeoutMinutes) : minutes);
  };

  const lockAdmin = async () => {
    const token = adminToken;
    setAdminToken("");
    setAdminPending(null);
    setAdminModalOpen(false);
    setPendingRefund(null);
    setScreen("home");
    if (token) { try { await api("/api/auth/logout", { method:"POST" }, token); } catch {} }
  };

  const downloadDatabaseBackup = async () => {
    const res = await fetch("/api/backup/database", { headers: { "x-admin-token": adminToken } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Could not create the database backup.");
    }
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^";]+)"?/i);
    const filename = match?.[1] || `grocery-pos-complete-backup-${new Date().toISOString().slice(0,10)}.zip`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const restoreDatabaseBackup = async (file, allowSchemaMismatch=false) => {
    const headers={"x-admin-token":adminToken,"Content-Type":"application/octet-stream"};
    if(allowSchemaMismatch) headers["x-allow-schema-mismatch"]="true";
    const res=await fetch("/api/backup/restore",{method:"POST",headers,body:file});
    const data=await res.json().catch(()=>({}));
    if(res.status===409&&data.code==="SCHEMA_MISMATCH") return {needsSchemaConfirmation:true,warning:data.warning,mismatches:data.mismatches||[]};
    if(!res.ok) throw new Error(data.error||"Could not restore the database backup.");
    setAdminToken("");setAdminPending(null);setAdminModalOpen(false);setScreen("home");
    window.location.reload();
    return {ok:true};
  };

  const touchAdminActivity = () => {
    if (adminToken) adminLastActivityRef.current = Date.now();
  };

  const loadProducts = async () => {
    setLoadingProducts(true);
    try {
      const [p, c] = await Promise.all([api("/api/products"), api("/api/categories")]);
      setProducts(p); setCategories(c); setError("");
    } catch (e) { setError(e.message); }
    finally { setLoadingProducts(false); }
  };

  const loadHistory = async (nextFilters = historyFilters) => {
    setLoadingHistory(true);
    try {
      const params = new URLSearchParams({ q: nextFilters.q, date: nextFilters.date, page: String(nextFilters.page), limit: String(nextFilters.limit) });
      const result = await api(`/api/transactions?${params.toString()}`);
      setTransactions(result.items); setHistoryMeta({ total: result.total, page: result.page, totalPages: result.totalPages }); setError("");
    } catch (e) { setError(e.message); }
    finally { setLoadingHistory(false); }
  };

  const loadReports = async (tokenOverride = adminToken, filterOverride = null) => {
    setLoadingReports(true);
    try { const qs = new URLSearchParams(filterOverride || reportFilters).toString(); const result = await api(`/api/sales-reports?${qs}`, {}, tokenOverride); setReportData(result); setError(""); }
    finally { setLoadingReports(false); }
  };

  const loadDashboard = async (days = dashboardData?.days || 30, tokenOverride = adminToken) => {
    setLoadingDashboard(true);
    try { const result = await api(`/api/dashboard?days=${days}`, {}, tokenOverride); setDashboardData(result); setError(""); }
    catch (e) { setError(e.message); }
    finally { setLoadingDashboard(false); }
  };

  const loadSalesSeries = async (granularity = salesGranularity, tokenOverride = adminToken) => {
    try { const result = await api(`/api/dashboard-series?granularity=${granularity}`, {}, tokenOverride); setSalesSeries(result.items || []); setError(""); }
    catch (e) { setError(e.message); }
  };

  const loadTopProducts = async (period = topProductsPeriod, tokenOverride = adminToken) => {
    try { const result = await api(`/api/top-products?period=${period}`, {}, tokenOverride); setTopProducts(result.items || []); setError(""); }
    catch (e) { setError(e.message); }
  };

  const loadPerformanceProducts = async (period = topProductsPeriod, query = performanceSearch, tokenOverride = adminToken) => {
    setPerformanceLoading(true);
    try { const params = new URLSearchParams({ period, q: query }); const result = await api(`/api/product-performance-list?${params.toString()}`, {}, tokenOverride); setPerformanceProducts(result.items || []); setError(""); }
    catch (e) { setError(e.message); }
    finally { setPerformanceLoading(false); }
  };

  const loadProductPerformance = async (product, granularity = "monthly") => {
    const productId = Number(product?.productId ?? product?.id);
    if (!Number.isInteger(productId) || productId < 1) {
      setError("Unable to load product performance: invalid product.");
      return;
    }
    const productSnapshot = product?.product ? product.product : product;
    setLoadingProductPerformance(true);
    setProductPerformance(prev => ({
      ...(prev || {}),
      product: productSnapshot,
      granularity,
      loading: true
    }));
    try {
      const result = await api(`/api/product-performance/${productId}?granularity=${granularity}`, {}, adminToken);
      setProductPerformance(result); setError("");
    } catch (e) { setError(e.message); }
    finally { setLoadingProductPerformance(false); }
  };

  const addExpense = async expense => {
    await api("/api/expenses", { method:"POST", body:JSON.stringify(expense) }, adminToken);
    await loadDashboard(dashboardData?.days || 30);
  };

  const deleteExpense = async expense => {
    await api(`/api/expenses/${expense.id}`, { method:"DELETE" }, adminToken);
    await loadDashboard(dashboardData?.days || 30);
  };

  useEffect(() => { loadProducts(); api("/api/auth/status").then(result => setAdminConfigured(Boolean(result.configured))).catch(() => {}); }, []);

  useEffect(() => {
    if (!adminToken) {
      adminLastActivityRef.current = 0;
      return;
    }

    // Keep activity in a ref so user interactions do not trigger a render/effect loop.
    adminLastActivityRef.current = Date.now();
    const events = ["mousedown", "keydown", "touchstart", "click"];
    const mark = () => { adminLastActivityRef.current = Date.now(); };
    events.forEach(event => window.addEventListener(event, mark, { passive: true }));
    const timer = adminTimeoutMinutes === 0 ? null : window.setInterval(() => {
      const timeoutMs = adminTimeoutMinutes * 60 * 1000;
      const lastActivity = adminLastActivityRef.current;
      if (lastActivity && Date.now() - lastActivity >= timeoutMs) lockAdmin();
    }, 15000);
    return () => {
      events.forEach(event => window.removeEventListener(event, mark));
      if (timer) window.clearInterval(timer);
    };
  }, [adminToken, adminTimeoutMinutes]);

  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.total, 0), [cart]);
  const safeDiscount = Math.max(0, Math.min(Number(discount) || 0, subtotal));
  const finalTotal = Math.max(0, subtotal - safeDiscount);
  const cashNumber = Number(cash) || 0;
  const change = Math.max(0, cashNumber - finalTotal);
  const filteredProducts = products.filter(p => p.isAvailable && (category === "All" || p.category === category) && p.name.toLowerCase().includes(search.toLowerCase()));

  const addToCart = item => { setCart(c => [...c, { ...item, cartId: crypto.randomUUID() }]); playPosSound("success"); };
  const removeItem = id => setCart(c => c.filter(x => x.cartId !== id));
  const clearCart = () => { setCart([]); setDiscount(0); setCash(""); };
  const resetNew = () => { clearCart(); setCompleted(null); setError(""); setSearch(""); setCategory("All"); setScreen("pos"); };
  const startTransaction = () => {
    if (adminToken || cashierToken) {
      resetNew();
      return;
    }
    // No one is signed in. Treat the primary New Transaction action as an
    // Owner/Admin operation; cashier users should sign in through Cashier Login
    // first so the sale is attributed to their cashier account.
    setError("");
    requestAdmin(() => resetNew());
  };

  const completeSale = async () => {
    if (!adminToken && !cashierToken) { setError("Please log in as a Cashier or Owner/Admin before completing a sale."); return; }
    if (!cart.length) { setError("Add at least one product before checkout."); return; }
    if (!String(cash).trim()) { setError("Cash received is required."); return; }
    if (cashNumber < finalTotal) { setError("Cash received is less than the amount to pay."); return; }
    setError("");
    try {
      const sale = await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({ subtotal, discount: safeDiscount, total: finalTotal, cashReceived: cashNumber, items: cart })
      }, adminToken, cashierToken);
      setCompleted(sale);
      playPosSound("success");
      setScreen("success");
    } catch (e) { playPosSound("error"); setError(e.message); }
  };

  const saveProduct = async product => {
    setError("");
    try {
      let saved;
      if (product.id) saved = await api(`/api/products/${product.id}`, { method:"PUT", body:JSON.stringify(product) }, adminToken);
      else saved = await api("/api/products", { method:"POST", body:JSON.stringify(product) }, adminToken);
      await loadProducts();
      return saved;
    } catch (e) { setError(e.message); throw e; }
  };

  const requestDeleteProduct = product => setPendingDelete(product);
  const confirmDeleteProduct = async () => {
    if (!pendingDelete) return;
    setDeletingProduct(true);
    try {
      await api(`/api/products/${pendingDelete.id}`, { method: "DELETE" }, adminToken);
      await loadProducts();
      setPendingDelete(null);
    } catch (e) { setError(e.message); }
    finally { setDeletingProduct(false); }
  };

  const saveCategory = async name => {
    try {
      const created = await api("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name })
      }, adminToken);
      const updatedCategories = await api("/api/categories");
      setCategories(updatedCategories);
      setError("");
      return created;
    } catch (e) {
      throw e;
    }
  };

  const requestAdmin = action => {
    if (adminToken) {
      touchAdminActivity();
      Promise.resolve(action(adminToken)).catch(e => setError(e.message));
      return;
    }
    setAdminPending(() => action);
    setAdminModalOpen(true);
  };

  const handleAdminSuccess = (token, wasSetup = false) => {
    setAdminToken(token);
    adminLastActivityRef.current = Date.now();
    if (wasSetup) setAdminConfigured(true);
    const action = adminPending;
    setAdminPending(null);
    setAdminModalOpen(false);
    if (action) Promise.resolve(action(token)).catch(e => setError(e.message));
  };

  const goHome = () => { if (adminToken) lockAdmin(); else setScreen("home"); };
  const goOwner = () => { setScreen("owner"); };

  const requestRefund = (transaction, items) => setPendingRefund({ transaction, items });
  const confirmRefund = () => {
    if (!pendingRefund?.transaction) return;
    const transaction = pendingRefund.transaction;
    const items = pendingRefund.items || [];
    requestAdmin(async token => {
      setRefunding(true);
      try {
        await api(`/api/transactions/${transaction.id}/refund`, { method:"POST", body:JSON.stringify({ reason:"Customer refund", items }) }, token || adminToken);
        setPendingRefund(null);
        await loadHistory(historyFilters);
        setAdminToken(token || adminToken);
        playPosSound("success");
      } catch (e) { playPosSound("error"); setError(e.message); throw e; }
      finally { setRefunding(false); }
    });
  };

  if (error && (screen === "home" || screen === "pos")) {
    // Keep errors non-blocking; shown below through the small status banner.
  }


  useEffect(() => { loadStoreInfo().catch(() => {}); loadReceiptSettings().catch(() => {}); }, []);

  const changeProductCardSize = size => {
    setProductCardSize(size);
    localStorage.setItem("pos-product-card-size", size);
  };

  if (screen === "home") return <main className="home"><section className="welcome home-welcome">
    <div className="brand-mark"><BrandLogo storeInfo={storeInfo} /></div><h1>{storeInfo?.storeName || "Grocery POS"}</h1><p>{storeInfo?.tagline || "Simple. Fast. Made for your store."}</p>
    <div className="home-actions">
      <button className="home-primary" onClick={startTransaction}><span>＋</span><div><b>New Transaction</b><small>Start a new sale{cashierUser ? ` · ${cashierUser.name}` : adminToken ? " · Owner" : ""}</small></div><i>→</i></button>
      <button className="home-history" onClick={() => { setScreen("history"); loadHistory(); }}><span className="action-icon">▤</span><div><b>Transaction History</b><small>View previous sales</small></div><i>→</i></button>
    </div>
    {cashierUser ? <><div className="cashier-session-bar"><span>👤 <b>{cashierUser.name}</b> · Cashier</span><button className="secondary small-btn" onClick={() => requestAdmin(() => setScreen("owner"))}>🔒 Owner</button><button className="secondary small-btn" onClick={logoutCashier}>Logout</button></div></> : <button className="owner-entry" onClick={() => requestAdmin(() => setScreen("owner"))}>
      <span className="owner-entry-icon">🔒</span><div><b>Owner / Admin</b><small>Dashboard, products &amp; settings</small></div><i>→</i>
    </button>}
    {!cashierUser && <button className="cashier-entry" onClick={() => setCashierLoginOpen(true)}><span className="owner-entry-icon">👤</span><div><b>Cashier Login</b><small>Sign in to record sales under your name</small></div><i>→</i></button>}
    <div className="home-footer">LOCAL POS <span>•</span> SQLITE DATABASE <button type="button" className="sound-toggle" onClick={() => { const next = !soundEnabled; localStorage.setItem(POS_SOUND_KEY, next ? "1" : "0"); setSoundEnabled(next); if (next) playPosSound("click"); }} title={soundEnabled ? "Sound effects on" : "Sound effects off"}>{soundEnabled ? "🔊 Sound On" : "🔇 Sound Off"}</button></div>
    {error && <div className="status-error">{error}</div>}
    {adminModalOpen && <AdminAuthModal configured={adminConfigured} onClose={() => { if (!refunding) { setAdminModalOpen(false); setAdminPending(null); } }} onSuccess={handleAdminSuccess} />}
    {cashierLoginOpen && <CashierLoginModal onClose={() => setCashierLoginOpen(false)} onSuccess={loginCashier} />}
  </section></main>;

  if (screen === "pos") return <main className="app">
    <header className="topbar"><button className="back" onClick={() => setScreen("home")}><span className="back-arrow">←</span><span>Home</span></button><div className="top-title"><BrandLogo storeInfo={storeInfo} className="mini-logo" /><h1>New Transaction</h1></div><div className="topbar-actions"><button type="button" className="sound-toggle top-sound" onClick={() => { const next = !soundEnabled; localStorage.setItem(POS_SOUND_KEY, next ? "1" : "0"); setSoundEnabled(next); if (next) playPosSound("click"); }} title={soundEnabled ? "Sound effects on" : "Sound effects off"}>{soundEnabled ? "🔊" : "🔇"}</button><span className="pill">{cart.length} item{cart.length !== 1 ? "s" : ""}</span></div></header>
    <div className="pos-layout">
      <section className="catalog">
        <div className="catalog-head"><div><div className="eyebrow">ORDER</div><h2>Choose Products</h2><p>Tap a product to enter its quantity and price type.</p></div><div className="catalog-search-actions"><button type="button" className="scan-product-button" onClick={() => setScannerOpen(true)}>▣ Scan Product</button><div className="search-wrap"><span>⌕</span><input className="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products..." /></div></div></div>
        <div className="catalog-controls"><div className="categories">{["All", ...categories.map(c => c.name)].map(c => <button key={c} className={category === c ? "active" : ""} onClick={() => setCategory(c)}>{c}</button>)}</div><div className="product-size-control" aria-label="Product card size"><span>Size</span>{[["small","S"],["medium","M"],["large","L"]].map(([v,label]) => <button type="button" key={v} className={productCardSize === v ? "active" : ""} onClick={() => changeProductCardSize(v)}>{label}</button>)}</div></div>
        {loadingProducts ? <div className="loading">Loading products...</div> : <div className={`product-grid product-grid-${productCardSize}`}>{filteredProducts.map(p => <button className="product-card" key={p.id} onClick={() => setModalProduct(p)}><div className="product-image">{p.imageData ? <img src={p.imageData} alt="" /> : <span>{p.emoji}</span>}</div><div className="product-info"><div className="product-name">{p.name}</div><div className="product-price">{peso(p.retail)} / {p.unit}<span>+</span></div></div></button>)}{!filteredProducts.length && <div className="no-results"><div>⌕</div><h3>No products found</h3><p>Try another search or category.</p></div>}</div>}
      </section>
      <aside className="cart">
        <div className="cart-title"><div><div className="eyebrow">CURRENT ORDER</div><h2>Your Cart</h2></div>{cart.length > 0 && <button className="clear" onClick={clearCart}>Clear all</button>}</div>
        <div className="cart-items">{!cart.length && <div className="empty"><div className="empty-basket">🛒</div><h3>Your cart is empty</h3><p>Select a product to start the sale.</p></div>}
          {cart.map(i => <div className="cart-item slide-in" key={i.cartId}><div className="cart-item-main"><span className="cart-visual">{i.imageData ? <img src={i.imageData} alt="" /> : i.emoji}</span><div><strong>{i.name}</strong><small>{i.priceType} · {qtyText(i)} · {peso(i.unitPrice)}/{i.unit}</small></div></div><div className="cart-item-right"><strong>{peso(i.total)}</strong><button className="remove" onClick={() => removeItem(i.cartId)}>×</button></div></div>)}
        </div>
        <div className="cart-bottom"><div className="row"><span>Subtotal</span><strong>{peso(subtotal)}</strong></div><div className="discount-row"><span>Discount <small>optional</small></span><div className="discount-keypad"><NumericField value={discount || ""} onChange={v => setDiscount(Math.max(0, Math.min(Number(v) || 0, subtotal)))} placeholder="0.00" prefix="₱" /></div></div><div className="total"><span>Total</span><strong>{peso(finalTotal)}</strong></div><button className="primary wide" disabled={!cart.length} onClick={() => setScreen("checkout")}>CHECKOUT <span>→</span></button></div>
      </aside>
    </div>
    {modalProduct && <ProductModal product={modalProduct} onClose={() => setModalProduct(null)} onAdd={addToCart} />}
    {scannerOpen && <BarcodeScannerModal products={products} onClose={() => setScannerOpen(false)} onAdd={items => { items.forEach(item => addToCart(item)); }} />}
  </main>;

  if (screen === "checkout") return <main className="checkout-page"><div className="checkout-card pop-in"><button className="back" onClick={() => setScreen("pos")}><span className="back-arrow">←</span><span>Back to order</span></button><div className="checkout-header"><div className="eyebrow">FINAL STEP</div><h1>Checkout</h1><p>Confirm the amount and enter the cash received.</p></div><div className="summary"><div className="row"><span>Subtotal</span><strong>{peso(subtotal)}</strong></div><div className="row discount-text"><span>Discount</span><strong>− {peso(safeDiscount)}</strong></div><div className="total"><span>Amount to Pay</span><strong>{peso(finalTotal)}</strong></div></div><label className="label">Cash Received</label><NumericField value={cash} onChange={v => { setCash(v); if (v) setError(""); }} placeholder="0.00" prefix="₱" autoFocus onEnter={completeSale} className={`cash-numeric ${error && (!cash || cashNumber < finalTotal) ? "field-invalid" : ""}`} />{!cash && error && <div className="field-error">Cash received is required.</div>}{cash && cashNumber < finalTotal && <div className="field-error">Cash received is less than the amount to pay.</div>}{error && <div className="error-text">{error}</div>}<div className="change-box"><span>Change</span><strong>{peso(change)}</strong></div><button className="primary wide" disabled={cashNumber < finalTotal || !cart.length} onClick={completeSale}>COMPLETE SALE <span>✓</span></button></div></main>;

  if (screen === "success") return <Success sale={completed} onNew={resetNew} onHome={() => { clearCart(); setCompleted(null); setScreen("home"); }} storeInfo={storeInfo} receiptSettings={receiptSettings} />;

  if (screen === "owner") return <OwnerMenu
    onProducts={() => { setScreen("products"); loadProducts(); }}
    onDashboard={() => { setScreen("dashboard"); loadDashboard(dashboardData?.days || 30); loadSalesSeries(salesGranularity); loadTopProducts(topProductsPeriod); loadPerformanceProducts(topProductsPeriod, performanceSearch); }}
    onReports={() => { setScreen("reports"); loadReports(); }}
    onStaff={() => { setScreen("staff"); loadStaff(); }}
    onDebt={() => { setScreen("debt"); loadDebts(); }}
    onAudit={() => { setScreen("audit"); loadAudit(); }}
    onSettings={() => { setScreen("settings"); loadAdminSettings(); }}
    onLock={lockAdmin}
    onHome={goHome}
    storeInfo={storeInfo}
  />;

  if (screen === "debt") return <DebtTracker data={debtData} loading={loadingDebt} filters={debtFilters} onFiltersChange={updateDebtFilters} onRefresh={() => loadDebts(debtFilters)} onHome={goOwner} onSaveDebt={saveDebt} onDeleteDebt={deleteDebt} onSavePayment={saveDebtPayment} onDeletePayment={deleteDebtPayment} storeInfo={storeInfo} adminToken={adminToken} />;

  if (screen === "staff") return <StaffManagement data={staffData} loading={loadingStaff} filters={staffFilters} onFiltersChange={updateStaffFilters} onRefresh={() => loadStaff(staffFilters)} onHome={goOwner} onSelectStaff={id => updateStaffFilters(f => ({...f, staff:id, page:1}))} />;

  if (screen === "audit") return <AuditLog data={auditData} loading={loadingAudit} filters={auditFilters} onFiltersChange={updateAuditFilters} onRefresh={() => loadAudit(auditFilters)} onHome={goOwner} storeInfo={storeInfo} />;

  if (screen === "settings") return <OwnerSettings settings={adminSettings} loading={loadingAdminSettings} onLoad={loadAdminSettings} onChangePasscode={changeAdminPasscode} onGenerateRecovery={generateRecoveryCode} onChangeTimeout={changeAdminTimeout} onLock={lockAdmin} onHome={goOwner} onBackup={downloadDatabaseBackup} onRestore={restoreDatabaseBackup} storeInfo={storeInfo} storeInfoLoading={loadingStoreInfo} onLoadStoreInfo={loadStoreInfo} onSaveStoreInfo={saveStoreInfo} receiptSettings={receiptSettings} receiptSettingsLoading={loadingReceiptSettings} onLoadReceiptSettings={loadReceiptSettings} onSaveReceiptSettings={saveReceiptSettings} onLoadCashiers={loadCashiers} onSaveCashier={saveCashier} />;

  if (screen === "reports") return <SalesReports data={reportData} loading={loadingReports} filters={reportFilters} onFiltersChange={setReportFilters} onRefresh={(filterOverride) => loadReports(adminToken, filterOverride)} onHome={goOwner} storeInfo={storeInfo} />;
  if (screen === "dashboard") return <><Dashboard data={dashboardData} loading={loadingDashboard} onRefresh={() => { loadDashboard(dashboardData?.days || 30); loadSalesSeries(salesGranularity); loadTopProducts(topProductsPeriod); loadPerformanceProducts(topProductsPeriod, performanceSearch); }} onDaysChange={days => loadDashboard(days)} onHome={goOwner} onAddExpense={addExpense} onDeleteExpense={deleteExpense} salesSeries={salesSeries} salesGranularity={salesGranularity} onSalesGranularityChange={g => { setSalesGranularity(g); loadSalesSeries(g); }} topProducts={topProducts} topProductsPeriod={topProductsPeriod} onTopProductsPeriodChange={p => { setTopProductsPeriod(p); loadTopProducts(p); loadPerformanceProducts(p, performanceSearch); }} performanceProducts={performanceProducts} performanceLoading={performanceLoading} performanceSearch={performanceSearch} onPerformanceSearchChange={q => { setPerformanceSearch(q); loadPerformanceProducts(topProductsPeriod, q); }} onProductSelect={p => loadProductPerformance(p, "monthly")} storeInfo={storeInfo} />{productPerformance && <ProductPerformanceModal data={productPerformance} loading={loadingProductPerformance} granularity={productPerformance.granularity || "monthly"} onGranularityChange={g => loadProductPerformance(productPerformance.product || productPerformance, g)} onClose={() => setProductPerformance(null)} />}</>;

  if (screen === "history") return <>
    <History transactions={transactions} total={historyMeta.total} page={historyMeta.page} totalPages={historyMeta.totalPages} loading={loadingHistory} filters={historyFilters} onFiltersChange={next => { setHistoryFilters(next); loadHistory(next); }} onRefresh={() => loadHistory(historyFilters)} onHome={() => { if (cashierToken && !adminToken) setScreen("home"); else goHome(); }} onRequestRefund={requestRefund} storeInfo={storeInfo} receiptSettings={receiptSettings} />
    {pendingRefund && <ConfirmModal title="Confirm refund?" message={`${pendingRefund.transaction.transactionNumber}: ${pendingRefund.items.length} item line${pendingRefund.items.length !== 1 ? "s" : ""} selected. The refunded amount will be removed from sales and profit calculations while the original receipt remains in history.`} confirmLabel="Refund Selected Items" busyLabel="Refunding..." onCancel={() => !refunding && setPendingRefund(null)} onConfirm={confirmRefund} busy={refunding} />}
    {adminModalOpen && <AdminAuthModal configured={adminConfigured} onClose={() => { if (!refunding) { setAdminModalOpen(false); setAdminPending(null); } }} onSuccess={handleAdminSuccess} />}
  </>;

  return <>
    <Products products={products} categories={categories} loading={loadingProducts} onRefresh={loadProducts} onSave={saveProduct} onDelete={requestDeleteProduct} onSaveCategory={saveCategory} onHome={goOwner} storeInfo={storeInfo} />
    {pendingDelete && <ConfirmModal title="Delete product?" message={`Delete “${pendingDelete.name}”? It will disappear from new sales, but existing receipts and transaction history will remain unchanged.`} confirmLabel="Delete Product" busyLabel="Deleting..." onCancel={() => !deletingProduct && setPendingDelete(null)} onConfirm={confirmDeleteProduct} busy={deletingProduct} />}
    {pendingRefund && <ConfirmModal title="Confirm refund?" message={`${pendingRefund.transaction.transactionNumber}: ${pendingRefund.items.length} item line${pendingRefund.items.length !== 1 ? "s" : ""} selected. The refunded amount will be removed from sales and profit calculations while the original receipt remains in history.`} confirmLabel="Refund Selected Items" busyLabel="Refunding..." onCancel={() => !refunding && setPendingRefund(null)} onConfirm={confirmRefund} busy={refunding} />}
    {adminModalOpen && <AdminAuthModal configured={adminConfigured} onClose={() => { if (!refunding) { setAdminModalOpen(false); setAdminPending(null); } }} onSuccess={handleAdminSuccess} />}
  </>;
}

createRoot(document.getElementById("root")).render(<App />);

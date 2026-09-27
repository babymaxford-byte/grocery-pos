const Fastify = require("fastify");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");

const app = Fastify({ logger: true, bodyLimit: 300 * 1024 * 1024 });
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer", bodyLimit: 300 * 1024 * 1024 }, (request, body, done) => done(null, body));

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const imageDir = path.join(dataDir, "product-images");
fs.mkdirSync(imageDir, { recursive: true });
const MANAGER_TOKEN = String(process.env.POS_MANAGER_TOKEN || "");
const APP_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version || "unknown"; } catch { return "unknown"; } })();

let db = new Database(path.join(dataDir, "pos.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('kg','piece')),
    retail_price REAL NOT NULL CHECK (retail_price >= 0),
    wholesale_price REAL NOT NULL CHECK (wholesale_price >= 0),
    cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
    emoji TEXT NOT NULL DEFAULT '🛒',
    barcode TEXT,
    image_data TEXT,
    deleted_at TEXT,
    category_id INTEGER,
    is_available INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    expense_date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS supplier_debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_name TEXT NOT NULL,
    debt_date TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    total_amount REAL NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS supplier_debt_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    cost REAL NOT NULL CHECK (cost >= 0),
    quantity TEXT NOT NULL DEFAULT '1',
    FOREIGN KEY (debt_id) REFERENCES supplier_debts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS supplier_debt_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id INTEGER NOT NULL,
    payment_date TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (debt_id) REFERENCES supplier_debts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_number TEXT NOT NULL UNIQUE,
    subtotal REAL NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL,
    cash_received REAL NOT NULL,
    change_amount REAL NOT NULL,
    cashier_id INTEGER,
    cashier_name TEXT,
    refunded_at TEXT,
    refund_reason TEXT,
    refund_status TEXT NOT NULL DEFAULT 'none',
    refunded_amount REAL NOT NULL DEFAULT 0,
    refunded_subtotal REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS admin_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt TEXT NOT NULL,
    passcode_hash TEXT NOT NULL,
    recovery_salt TEXT,
    recovery_hash TEXT,
    session_timeout_minutes INTEGER NOT NULL DEFAULT 15,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS cashier_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('owner','cashier','system','unknown')),
    actor_id INTEGER,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    transaction_id INTEGER,
    product_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS store_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    store_name TEXT NOT NULL DEFAULT 'Grocery POS',
    tagline TEXT NOT NULL DEFAULT 'Simple. Fast. Made for your store.',
    address TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    logo_data TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS receipt_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    show_logo INTEGER NOT NULL DEFAULT 1,
    show_store_name INTEGER NOT NULL DEFAULT 1,
    show_tagline INTEGER NOT NULL DEFAULT 1,
    show_address INTEGER NOT NULL DEFAULT 1,
    show_contact INTEGER NOT NULL DEFAULT 1,
    show_transaction_number INTEGER NOT NULL DEFAULT 1,
    show_datetime INTEGER NOT NULL DEFAULT 1,
    show_payment_method INTEGER NOT NULL DEFAULT 1,
    logo_size TEXT NOT NULL DEFAULT 'medium' CHECK (logo_size IN ('small','medium','large')),
    layout TEXT NOT NULL DEFAULT 'standard' CHECK (layout IN ('compact','standard')),
    footer_message TEXT NOT NULL DEFAULT 'Thank you for shopping with us!',
    refund_message TEXT NOT NULL DEFAULT 'Please keep this receipt for your records.',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS transaction_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    unit TEXT NOT NULL CHECK (unit IN ('kg','piece')),
    price_type TEXT NOT NULL CHECK (price_type IN ('retail','wholesale')),
    unit_price REAL NOT NULL,
    cost_price REAL NOT NULL DEFAULT 0,
    quantity REAL NOT NULL,
    total REAL NOT NULL,
    refunded_quantity REAL NOT NULL DEFAULT 0,
    refunded_total REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
  );
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_supplier_debts_date ON supplier_debts(debt_date); CREATE INDEX IF NOT EXISTS idx_supplier_debts_supplier ON supplier_debts(supplier_name); CREATE INDEX IF NOT EXISTS idx_supplier_debt_payments_debt ON supplier_debt_payments(debt_id);`);

const productColumns = db.prepare("PRAGMA table_info(products)").all();
if (!productColumns.some(c => c.name === "image_data")) {
  db.exec("ALTER TABLE products ADD COLUMN image_data TEXT");
}
if (!productColumns.some(c => c.name === "deleted_at")) {
  db.exec("ALTER TABLE products ADD COLUMN deleted_at TEXT");
}
if (!productColumns.some(c => c.name === "cost_price")) {
  db.exec("ALTER TABLE products ADD COLUMN cost_price REAL NOT NULL DEFAULT 0");
}
const supplierDebtItemColumns = db.prepare("PRAGMA table_info(supplier_debt_items)").all();
if (!supplierDebtItemColumns.some(c => c.name === "quantity")) {
  db.exec("ALTER TABLE supplier_debt_items ADD COLUMN quantity TEXT NOT NULL DEFAULT '1'");
} else {
  const quantityColumn = supplierDebtItemColumns.find(c => c.name === "quantity");
  // v4.9.6 stored quantity as a numeric field with a positive-value CHECK.
  // Debt quantities are descriptive (e.g. "1 crate", "10 boxes"), so migrate
  // the column to unrestricted text while preserving every existing value.
  if (String(quantityColumn.type || "").toUpperCase() !== "TEXT") {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      BEGIN;
      CREATE TABLE supplier_debt_items__text (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debt_id INTEGER NOT NULL,
        description TEXT NOT NULL,
        cost REAL NOT NULL CHECK (cost >= 0),
        quantity TEXT NOT NULL DEFAULT '1',
        FOREIGN KEY (debt_id) REFERENCES supplier_debts(id) ON DELETE CASCADE
      );
      INSERT INTO supplier_debt_items__text (id, debt_id, description, cost, quantity)
        SELECT id, debt_id, description, cost, CAST(quantity AS TEXT) FROM supplier_debt_items;
      DROP TABLE supplier_debt_items;
      ALTER TABLE supplier_debt_items__text RENAME TO supplier_debt_items;
      COMMIT;
      PRAGMA foreign_keys = ON;
    `);
  }
}

if (!productColumns.some(c => c.name === "barcode")) {
  db.exec("ALTER TABLE products ADD COLUMN barcode TEXT");
}
try {
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_active ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '' AND deleted_at IS NULL");
} catch {}
const transactionItemColumns = db.prepare("PRAGMA table_info(transaction_items)").all();
if (!transactionItemColumns.some(c => c.name === "cost_price")) {
  db.exec("ALTER TABLE transaction_items ADD COLUMN cost_price REAL NOT NULL DEFAULT 0");
}
if (!transactionItemColumns.some(c => c.name === "refunded_quantity")) {
  db.exec("ALTER TABLE transaction_items ADD COLUMN refunded_quantity REAL NOT NULL DEFAULT 0");
}
if (!transactionItemColumns.some(c => c.name === "refunded_total")) {
  db.exec("ALTER TABLE transaction_items ADD COLUMN refunded_total REAL NOT NULL DEFAULT 0");
}
const refundColumns = db.prepare("PRAGMA table_info(transactions)").all();
if (!refundColumns.some(c => c.name === "refund_status")) {
  db.exec("ALTER TABLE transactions ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none'");
}
if (!refundColumns.some(c => c.name === "refunded_amount")) {
  db.exec("ALTER TABLE transactions ADD COLUMN refunded_amount REAL NOT NULL DEFAULT 0");
}
if (!refundColumns.some(c => c.name === "refunded_subtotal")) {
  db.exec("ALTER TABLE transactions ADD COLUMN refunded_subtotal REAL NOT NULL DEFAULT 0");
}
// Migrate transactions that were fully refunded by earlier POS versions.
db.exec(`UPDATE transactions SET refund_status='full', refunded_amount=total, refunded_subtotal=subtotal WHERE refunded_at IS NOT NULL AND (refund_status IS NULL OR refund_status='none')`);
db.exec(`
  CREATE TABLE IF NOT EXISTS refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    subtotal_amount REAL NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
  );
`);
const adminColumns = db.prepare("PRAGMA table_info(admin_auth)").all();
if (!adminColumns.some(c => c.name === "recovery_salt")) {
  db.exec("ALTER TABLE admin_auth ADD COLUMN recovery_salt TEXT");
}
if (!adminColumns.some(c => c.name === "recovery_hash")) {
  db.exec("ALTER TABLE admin_auth ADD COLUMN recovery_hash TEXT");
}
if (!adminColumns.some(c => c.name === "session_timeout_minutes")) {
  db.exec("ALTER TABLE admin_auth ADD COLUMN session_timeout_minutes INTEGER NOT NULL DEFAULT 15");
}

const transactionColumns = db.prepare("PRAGMA table_info(transactions)").all();
if (!transactionColumns.some(c => c.name === "cashier_id")) {
  db.exec("ALTER TABLE transactions ADD COLUMN cashier_id INTEGER");
}
if (!transactionColumns.some(c => c.name === "cashier_name")) {
  db.exec("ALTER TABLE transactions ADD COLUMN cashier_name TEXT");
}
if (!transactionColumns.some(c => c.name === "refunded_at")) {
  db.exec("ALTER TABLE transactions ADD COLUMN refunded_at TEXT");
}
if (!transactionColumns.some(c => c.name === "refund_reason")) {
  db.exec("ALTER TABLE transactions ADD COLUMN refund_reason TEXT");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS receipt_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    show_logo INTEGER NOT NULL DEFAULT 1,
    show_store_name INTEGER NOT NULL DEFAULT 1,
    show_tagline INTEGER NOT NULL DEFAULT 1,
    show_address INTEGER NOT NULL DEFAULT 1,
    show_contact INTEGER NOT NULL DEFAULT 1,
    show_transaction_number INTEGER NOT NULL DEFAULT 1,
    show_datetime INTEGER NOT NULL DEFAULT 1,
    show_payment_method INTEGER NOT NULL DEFAULT 1,
    logo_size TEXT NOT NULL DEFAULT 'medium',
    layout TEXT NOT NULL DEFAULT 'standard',
    footer_message TEXT NOT NULL DEFAULT 'Thank you for shopping with us!',
    refund_message TEXT NOT NULL DEFAULT 'Please keep this receipt for your records.',
    updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);
if (!db.prepare("SELECT id FROM receipt_settings WHERE id=1").get()) db.prepare("INSERT INTO receipt_settings (id) VALUES (1)").run();

const activeAdminTokens = new Map();
const activeCashierTokens = new Map();
const DEFAULT_ADMIN_TIMEOUT_MINUTES = 15;
const ALLOWED_ADMIN_TIMEOUTS = [0, 5, 10, 15, 30];

function normalizePasscode(value) {
  return String(value ?? "").trim();
}

function hashPasscode(passcode, salt) {
  return crypto.scryptSync(passcode, salt, 64).toString("hex");
}

function normalizeRecoveryCode(value) {
  return String(value ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function generateRecoveryCode() {
  const raw = crypto.randomBytes(16).toString("hex").toUpperCase();
  return raw.match(/.{1,4}/g).join("-");
}

function verifySecret(secret, salt, storedHash) {
  if (!salt || !storedHash) return false;
  const candidate = Buffer.from(hashPasscode(secret, salt), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function adminSettings() {
  const row = db.prepare("SELECT session_timeout_minutes AS sessionTimeoutMinutes, recovery_hash AS recoveryHash FROM admin_auth WHERE id=1").get();
  const rawTimeout = row?.sessionTimeoutMinutes;
  const timeout = rawTimeout === null || rawTimeout === undefined ? DEFAULT_ADMIN_TIMEOUT_MINUTES : Number(rawTimeout);
  return { sessionTimeoutMinutes: ALLOWED_ADMIN_TIMEOUTS.includes(timeout) ? timeout : DEFAULT_ADMIN_TIMEOUT_MINUTES, hasRecoveryCode: Boolean(row?.recoveryHash) };
}

function createAdminToken() {
  const token = crypto.randomBytes(32).toString("hex");
  activeAdminTokens.set(token, Date.now());
  return token;
}

function isAdminAuthorized(request) {
  const token = String(request.headers["x-admin-token"] || "");
  if (!token) return false;
  const lastUsed = activeAdminTokens.get(token);
  const timeoutMinutes = adminSettings().sessionTimeoutMinutes;
  if (timeoutMinutes === 0) {
    activeAdminTokens.set(token, Date.now());
    return true;
  }
  const timeoutMs = timeoutMinutes * 60 * 1000;
  if (!lastUsed || Date.now() - lastUsed > timeoutMs) {
    activeAdminTokens.delete(token);
    return false;
  }
  activeAdminTokens.set(token, Date.now());
  return true;
}

function isManagerAuthorized(request) {
  return Boolean(MANAGER_TOKEN) && String(request.headers["x-manager-token"] || "") === MANAGER_TOKEN;
}

function requireAdmin(request, reply) {
  if (isAdminAuthorized(request)) return true;
  reply.code(401).send({ error: "Admin authorization required." });
  return false;
}
function createCashierToken(cashier) {
  const token = crypto.randomBytes(32).toString("hex");
  activeCashierTokens.set(token, { id: Number(cashier.id), name: cashier.name, lastUsed: Date.now() });
  return token;
}

function getCashierSession(request) {
  const token = String(request.headers["x-cashier-token"] || "");
  if (!token) return null;
  const session = activeCashierTokens.get(token);
  const timeoutMs = 12 * 60 * 60 * 1000;
  if (!session || Date.now() - session.lastUsed > timeoutMs) {
    activeCashierTokens.delete(token);
    return null;
  }
  session.lastUsed = Date.now();
  activeCashierTokens.set(token, session);
  return { token, ...session };
}

function requireCashierOrAdmin(request, reply) {
  if (isAdminAuthorized(request)) return { role: "admin" };
  const cashier = getCashierSession(request);
  if (cashier) return { role: "cashier", cashier };
  reply.code(401).send({ error: "Cashier or admin authorization required." });
  return null;
}


function auditActor(request, fallbackType = 'system') {
  if (isAdminAuthorized(request)) return { type: 'owner', id: null, name: 'Owner' };
  const cashier = getCashierSession(request);
  if (cashier) return { type: 'cashier', id: cashier.id, name: cashier.name };
  return { type: fallbackType, id: null, name: fallbackType === 'unknown' ? 'Unknown' : 'System' };
}

function writeAudit(request, action, details = '', extra = {}, actorOverride = null) {
  const actor = actorOverride || auditActor(request);
  db.prepare(`INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, details, transaction_id, product_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(actor.type, actor.id, String(actor.name || 'System'), String(action), String(details || ''), extra.transactionId || null, extra.productId || null);
}


const seedCategories = ["Vegetables", "Fruits", "Groceries"];
const seedProducts = [
  ["Onion","kg",120,100,75,"🧅","Vegetables"],["Tomato","kg",100,85,60,"🍅","Vegetables"],
  ["Potato","kg",90,75,55,"🥔","Vegetables"],["Cabbage","piece",80,65,45,"🥬","Vegetables"],
  ["Banana","kg",75,60,45,"🍌","Fruits"],["Coconut","piece",35,28,20,"🥥","Fruits"],
  ["Rice","kg",55,50,42,"🍚","Groceries"],["Eggs","piece",9,8,6,"🥚","Groceries"],
  ["Carrot","kg",110,95,70,"🥕","Vegetables"],["Apple","kg",180,160,125,"🍎","Fruits"],
  ["Mango","kg",140,120,90,"🥭","Fruits"],["Garlic","kg",190,170,125,"🧄","Vegetables"]
];

const categoryCount = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
if (categoryCount === 0) {
  const insertCategory = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
  db.transaction(() => seedCategories.forEach((name, i) => insertCategory.run(name, i)))();
}
const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
if (productCount === 0) {
  const getCategory = db.prepare("SELECT id FROM categories WHERE name = ?");
  const insertProduct = db.prepare(`
    INSERT INTO products (name, unit, retail_price, wholesale_price, cost_price, emoji, image_data, category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    seedProducts.forEach(([name,unit,retail,wholesale,cost,emoji,category]) => {
      insertProduct.run(name, unit, retail, wholesale, cost, emoji, null, getCategory.get(category)?.id ?? null);
    });
  })();
}

function saveProductImage(id, imageData) {
  if (!imageData) return null;
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(imageData)) {
    throw new Error("Invalid product image data.");
  }
  const match = imageData.match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/i);
  if (!match) throw new Error("Invalid product image data.");
  const ext = match[1].toLowerCase().replace("jpeg", "jpg");
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 4 * 1024 * 1024) throw new Error("Product image is too large.");
  const filename = `product-${id}.${ext}`;
  fs.writeFileSync(path.join(imageDir, filename), buffer);
  return `/api/product-images/${filename}`;
}

function deleteProductImageFile(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith("/api/product-images/")) return;
  const filename = path.basename(imageUrl);
  const target = path.join(imageDir, filename);
  if (target.startsWith(imageDir) && fs.existsSync(target)) fs.unlinkSync(target);
}

app.get("/api/product-images/:filename", async (request, reply) => {
  const filename = path.basename(String(request.params.filename || ""));
  if (!/^product-\d+\.(jpg|jpeg|png|webp)$/i.test(filename)) return reply.code(400).send({ error: "Invalid image." });
  const target = path.join(imageDir, filename);
  if (!fs.existsSync(target)) return reply.code(404).send({ error: "Image not found." });
  const ext = path.extname(target).toLowerCase();
  const types = { ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".png":"image/png", ".webp":"image/webp" };
  return reply.type(types[ext] || "application/octet-stream").send(fs.createReadStream(target));
});

function productRows() {
  return db.prepare(`
    SELECT p.id, p.name, p.unit,
           p.retail_price AS retail, p.wholesale_price AS wholesale, p.cost_price AS costPrice,
           p.barcode, p.emoji, p.image_data AS imageData, p.is_available AS isAvailable,
           p.deleted_at AS deletedAt, (p.deleted_at IS NOT NULL) AS isDeleted,
           p.category_id AS categoryId,
           COALESCE(c.name, 'Uncategorized') AS category
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY (p.deleted_at IS NULL) DESC, p.is_available DESC, c.sort_order ASC, p.name COLLATE NOCASE ASC
  `).all();
}

app.get("/api/auth/status", async () => ({ configured: Boolean(db.prepare("SELECT id FROM admin_auth WHERE id=1").get()) }));

function storeInfo() {
  let row = db.prepare("SELECT store_name AS storeName, tagline, address, contact, logo_data AS logoData FROM store_settings WHERE id=1").get();
  if (!row) {
    db.prepare("INSERT INTO store_settings (id) VALUES (1)").run();
    row = db.prepare("SELECT store_name AS storeName, tagline, address, contact, logo_data AS logoData FROM store_settings WHERE id=1").get();
  }
  return row;
}

app.get("/api/store-info", async () => storeInfo());

app.put("/api/store-info", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const b = request.body || {};
  const storeName = String(b.storeName ?? '').trim();
  const tagline = String(b.tagline ?? '').trim();
  const address = String(b.address ?? '').trim();
  const contact = String(b.contact ?? '').trim();
  const logoData = b.logoData ? String(b.logoData) : null;
  if (!storeName) return reply.code(400).send({ error: "Store name is required." });
  if (storeName.length > 80) return reply.code(400).send({ error: "Store name must be 80 characters or fewer." });
  if (tagline.length > 120) return reply.code(400).send({ error: "Tagline must be 120 characters or fewer." });
  if (address.length > 200) return reply.code(400).send({ error: "Address must be 200 characters or fewer." });
  if (contact.length > 120) return reply.code(400).send({ error: "Contact details must be 120 characters or fewer." });
  if (logoData && !/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(logoData)) return reply.code(400).send({ error: "Invalid store logo image." });
  if (logoData && Buffer.byteLength(logoData, 'utf8') > 700 * 1024) return reply.code(400).send({ error: "Store logo is too large. Please choose a smaller image." });
  db.prepare(`UPDATE store_settings SET store_name=?, tagline=?, address=?, contact=?, logo_data=?, updated_at=datetime('now','localtime') WHERE id=1`).run(storeName, tagline, address, contact, logoData);
  writeAudit(request, 'Store information changed', `Updated store information for ${storeName}.`);
  return storeInfo();
});

function receiptSettings() {
  const row = db.prepare(`SELECT show_logo AS showLogo, show_store_name AS showStoreName, show_tagline AS showTagline, show_address AS showAddress, show_contact AS showContact, show_transaction_number AS showTransactionNumber, show_datetime AS showDatetime, show_payment_method AS showPaymentMethod, logo_size AS logoSize, layout, footer_message AS footerMessage, refund_message AS refundMessage FROM receipt_settings WHERE id=1`).get();
  return row || { showLogo:1, showStoreName:1, showTagline:1, showAddress:1, showContact:1, showTransactionNumber:1, showDatetime:1, showPaymentMethod:1, logoSize:'medium', layout:'standard', footerMessage:'Thank you for shopping with us!', refundMessage:'Please keep this receipt for your records.' };
}

app.get("/api/receipt-settings", async () => receiptSettings());

app.put("/api/receipt-settings", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const b = request.body || {};
  const bool = v => v ? 1 : 0;
  const logoSize = ['small','medium','large'].includes(String(b.logoSize)) ? String(b.logoSize) : 'medium';
  const layout = ['compact','standard'].includes(String(b.layout)) ? String(b.layout) : 'standard';
  const footerMessage = String(b.footerMessage ?? '').trim();
  const refundMessage = String(b.refundMessage ?? '').trim();
  if (footerMessage.length > 160) return reply.code(400).send({ error: "Footer message must be 160 characters or fewer." });
  if (refundMessage.length > 160) return reply.code(400).send({ error: "Receipt note must be 160 characters or fewer." });
  db.prepare(`UPDATE receipt_settings SET show_logo=?, show_store_name=?, show_tagline=?, show_address=?, show_contact=?, show_transaction_number=?, show_datetime=?, show_payment_method=?, logo_size=?, layout=?, footer_message=?, refund_message=?, updated_at=datetime('now','localtime') WHERE id=1`).run(
    bool(b.showLogo), bool(b.showStoreName), bool(b.showTagline), bool(b.showAddress), bool(b.showContact), bool(b.showTransactionNumber), bool(b.showDatetime), bool(b.showPaymentMethod), logoSize, layout, footerMessage, refundMessage
  );
  writeAudit(request, 'Receipt settings changed', 'Updated receipt display and footer settings.');
  return receiptSettings();
});

app.post("/api/auth/setup", async (request, reply) => {
  if (db.prepare("SELECT id FROM admin_auth WHERE id=1").get()) return reply.code(409).send({ error: "Admin passcode is already configured." });
  const passcode = normalizePasscode(request.body?.passcode);
  if (!/^\d{4,12}$/.test(passcode)) return reply.code(400).send({ error: "Passcode must contain 4 to 12 digits." });
  const salt = crypto.randomBytes(16).toString("hex");
  const recoveryCode = generateRecoveryCode();
  const recoverySalt = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO admin_auth (id, salt, passcode_hash, recovery_salt, recovery_hash, session_timeout_minutes) VALUES (1, ?, ?, ?, ?, ?)").run(salt, hashPasscode(passcode, salt), recoverySalt, hashPasscode(normalizeRecoveryCode(recoveryCode), recoverySalt), DEFAULT_ADMIN_TIMEOUT_MINUTES);
  return { ok: true, token: createAdminToken(), recoveryCode };
});

app.post("/api/auth/login", async (request, reply) => {
  const auth = db.prepare("SELECT salt, passcode_hash AS passcodeHash FROM admin_auth WHERE id=1").get();
  if (!auth) return reply.code(409).send({ error: "Admin passcode has not been configured." });
  const passcode = normalizePasscode(request.body?.passcode);
  if (!/^\d{4,12}$/.test(passcode)) return reply.code(400).send({ error: "Enter your 4 to 12 digit admin passcode." });
  if (!verifySecret(passcode, auth.salt, auth.passcodeHash)) {
    writeAudit(request, 'Failed Owner login', 'Incorrect Owner/Admin passcode.', {}, {type:'unknown',id:null,name:'Unknown'});
    return reply.code(401).send({ error: "Incorrect admin passcode." });
  }
  writeAudit(request, 'Owner login', 'Owner/Admin access unlocked.', {}, {type:'owner',id:null,name:'Owner'});
  return { ok: true, token: createAdminToken() };
});

app.get("/api/cashiers", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return db.prepare("SELECT id, name, username, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM cashier_accounts ORDER BY is_active DESC, name COLLATE NOCASE").all();
});

app.post("/api/cashiers", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const name = String(request.body?.name || "").trim();
  const username = String(request.body?.username || "").trim();
  const pin = normalizePasscode(request.body?.pin);
  if (!name || name.length > 80) return reply.code(400).send({ error: "Cashier name is required and must be 80 characters or fewer." });
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return reply.code(400).send({ error: "Username must be 3 to 32 characters using letters, numbers, dot, underscore or hyphen." });
  if (!/^\d{4,12}$/.test(pin)) return reply.code(400).send({ error: "Cashier PIN must contain 4 to 12 digits." });
  const salt = crypto.randomBytes(16).toString("hex");
  try {
    const result = db.prepare("INSERT INTO cashier_accounts (name, username, salt, pin_hash) VALUES (?, ?, ?, ?)").run(name, username, salt, hashPasscode(pin, salt));
    writeAudit(request, 'Cashier account created', `Created cashier account ${name} (@${username}).`);
    return reply.code(201).send({ id: Number(result.lastInsertRowid), name, username, isActive: 1 });
  } catch {
    return reply.code(409).send({ error: "That username is already in use." });
  }
});

app.put("/api/cashiers/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id = Number(request.params.id);
  const existing = db.prepare("SELECT * FROM cashier_accounts WHERE id=?").get(id);
  if (!existing) return reply.code(404).send({ error: "Cashier account not found." });
  const name = String(request.body?.name ?? existing.name).trim();
  const username = String(request.body?.username ?? existing.username).trim();
  const pin = request.body?.pin == null ? "" : normalizePasscode(request.body.pin);
  const isActive = request.body?.isActive === false ? 0 : 1;
  if (!name || name.length > 80) return reply.code(400).send({ error: "Cashier name is required and must be 80 characters or fewer." });
  if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) return reply.code(400).send({ error: "Username must be 3 to 32 characters using letters, numbers, dot, underscore or hyphen." });
  if (pin && !/^\d{4,12}$/.test(pin)) return reply.code(400).send({ error: "Cashier PIN must contain 4 to 12 digits." });
  try {
    if (pin) {
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE cashier_accounts SET name=?, username=?, salt=?, pin_hash=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?").run(name, username, salt, hashPasscode(pin, salt), isActive, id);
    } else {
      db.prepare("UPDATE cashier_accounts SET name=?, username=?, is_active=?, updated_at=datetime('now','localtime') WHERE id=?").run(name, username, isActive, id);
    }
    for (const [token, session] of activeCashierTokens) if (session.id === id) activeCashierTokens.delete(token);
    writeAudit(request, 'Cashier account updated', `Updated cashier account ${name} (@${username}); status ${isActive ? 'active' : 'disabled'}.`);
    return { id, name, username, isActive };
  } catch {
    return reply.code(409).send({ error: "That username is already in use." });
  }
});

app.post("/api/cashier/login", async (request, reply) => {
  const username = String(request.body?.username || "").trim();
  const pin = normalizePasscode(request.body?.pin);
  const cashier = db.prepare("SELECT id, name, username, salt, pin_hash AS pinHash, is_active AS isActive FROM cashier_accounts WHERE username=? COLLATE NOCASE").get(username);
  if (!cashier || !cashier.isActive || !verifySecret(pin, cashier.salt, cashier.pinHash)) {
    writeAudit(request, 'Failed Cashier login', username ? `Failed login for username ${username}.` : 'Cashier login submitted without a username.', {}, {type:'unknown',id:null,name:username ? `Unknown (${username})` : 'Unknown'});
    return reply.code(401).send({ error: "Incorrect cashier username or PIN." });
  }
  writeAudit(request, 'Cashier login', 'Cashier session started.', {}, {type:'cashier',id:Number(cashier.id),name:cashier.name});
  return { ok: true, token: createCashierToken(cashier), cashier: { id: cashier.id, name: cashier.name, username: cashier.username } };
});

app.post("/api/cashier/logout", async (request) => {
  const token = String(request.headers["x-cashier-token"] || "");
  const session = activeCashierTokens.get(token);
  if (session) writeAudit(request, 'Cashier logout', 'Cashier session ended.', {}, {type:'cashier',id:session.id,name:session.name});
  activeCashierTokens.delete(token);
  return { ok: true };
});

app.get("/api/auth/settings", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  return adminSettings();
});

app.put("/api/auth/settings", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const timeout = Number(request.body?.sessionTimeoutMinutes);
  if (!ALLOWED_ADMIN_TIMEOUTS.includes(timeout)) return reply.code(400).send({ error: "Session timeout must be Never, 5, 10, 15 or 30 minutes." });
  db.prepare("UPDATE admin_auth SET session_timeout_minutes=? WHERE id=1").run(timeout);
  writeAudit(request, 'Admin session timeout changed', timeout === 0 ? 'Set Owner/Admin session timeout to Never.' : `Set Owner/Admin session timeout to ${timeout} minutes.`);
  return adminSettings();
});

app.post("/api/auth/change-passcode", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const current = normalizePasscode(request.body?.currentPasscode);
  const next = normalizePasscode(request.body?.newPasscode);
  const auth = db.prepare("SELECT salt, passcode_hash AS passcodeHash FROM admin_auth WHERE id=1").get();
  if (!auth || !verifySecret(current, auth.salt, auth.passcodeHash)) return reply.code(401).send({ error: "Current passcode is incorrect." });
  if (!/^\d{4,12}$/.test(next)) return reply.code(400).send({ error: "New passcode must contain 4 to 12 digits." });
  if (current === next) return reply.code(400).send({ error: "New passcode must be different from the current passcode." });
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE admin_auth SET salt=?, passcode_hash=? WHERE id=1").run(salt, hashPasscode(next, salt));
  writeAudit(request, 'Admin passcode changed', 'Owner/Admin passcode was changed.');
  activeAdminTokens.clear();
  return { ok: true, token: createAdminToken() };
});

app.post("/api/auth/recovery-code", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const recoveryCode = generateRecoveryCode();
  const salt = crypto.randomBytes(16).toString("hex");
  db.prepare("UPDATE admin_auth SET recovery_salt=?, recovery_hash=? WHERE id=1").run(salt, hashPasscode(normalizeRecoveryCode(recoveryCode), salt));
  writeAudit(request, 'Recovery code generated', 'Generated a new Owner/Admin recovery code.');
  return { ok: true, recoveryCode };
});

app.post("/api/auth/recover", async (request, reply) => {
  const code = normalizeRecoveryCode(request.body?.recoveryCode);
  const next = normalizePasscode(request.body?.newPasscode);
  if (!/^[A-F0-9]{32}$/.test(code)) return reply.code(400).send({ error: "Enter the complete recovery code." });
  if (!/^\d{4,12}$/.test(next)) return reply.code(400).send({ error: "New passcode must contain 4 to 12 digits." });
  const auth = db.prepare("SELECT recovery_salt AS recoverySalt, recovery_hash AS recoveryHash FROM admin_auth WHERE id=1").get();
  if (!auth || !auth.recoveryHash || !verifySecret(code, auth.recoverySalt, auth.recoveryHash)) return reply.code(401).send({ error: "Recovery code is incorrect or has already been used." });
  const salt = crypto.randomBytes(16).toString("hex");
  const result = db.prepare("UPDATE admin_auth SET salt=?, passcode_hash=?, recovery_salt=NULL, recovery_hash=NULL WHERE id=1 AND recovery_hash=?").run(salt, hashPasscode(next, salt), auth.recoveryHash);
  if (!result.changes) return reply.code(409).send({ error: "Recovery code is no longer valid. Try again with a new code." });
  writeAudit(request, 'Admin passcode recovered', 'Owner/Admin passcode was reset using the recovery code.', {}, {type:'owner',id:null,name:'Owner'});
  activeAdminTokens.clear();
  return { ok: true, token: createAdminToken() };
});

app.post("/api/auth/logout", async (request) => {
  const token = String(request.headers["x-admin-token"] || "");
  if (activeAdminTokens.has(token)) writeAudit(request, 'Owner logout', 'Owner/Admin session ended.', {}, {type:'owner',id:null,name:'Owner'});
  activeAdminTokens.delete(token);
  return { ok: true };
});

app.get('/api/audit-logs', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const start = String(request.query?.start || '');
  const end = String(request.query?.end || '');
  const staff = String(request.query?.staff || 'all');
  const action = String(request.query?.action || 'all');
  const q = String(request.query?.q || '').trim();
  const page = Math.max(Number(request.query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(request.query?.limit) || 50, 1), 100);
  if (start && !/^\d{4}-\d{2}-\d{2}$/.test(start)) return reply.code(400).send({ error: 'Invalid start date.' });
  if (end && !/^\d{4}-\d{2}-\d{2}$/.test(end)) return reply.code(400).send({ error: 'Invalid end date.' });
  if (start && end && start > end) return reply.code(400).send({ error: 'Start date must be on or before end date.' });
  const where=[]; const params=[];
  if (start) { where.push('date(a.created_at) >= date(?)'); params.push(start); }
  if (end) { where.push('date(a.created_at) <= date(?)'); params.push(end); }
  if (staff !== 'all') { if (staff === 'owner') where.push("a.actor_type='owner'"); else if (staff === 'unknown') where.push("a.actor_type='unknown'"); else if (/^\d+$/.test(staff)) { where.push("a.actor_type='cashier' AND a.actor_id=?"); params.push(Number(staff)); } }
  if (action !== 'all') { where.push('a.action=?'); params.push(action); }
  if (q) { where.push('(a.actor_name LIKE ? OR a.action LIKE ? OR a.details LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  const whereSql=where.length?`WHERE ${where.join(' AND ')}`:'';
  const total=Number(db.prepare(`SELECT COUNT(*) AS count FROM audit_logs a ${whereSql}`).get(...params).count);
  const rows=db.prepare(`SELECT a.id, a.actor_type AS actorType, a.actor_id AS actorId, a.actor_name AS actorName, a.action, a.details, a.transaction_id AS transactionId, a.product_id AS productId, a.created_at AS createdAt, t.transaction_number AS transactionNumber FROM audit_logs a LEFT JOIN transactions t ON t.id=a.transaction_id ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params,limit,(page-1)*limit);
  const actions=db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action COLLATE NOCASE').all().map(x=>x.action);
  const staffRows=db.prepare("SELECT id, name, is_active AS isActive FROM cashier_accounts ORDER BY name COLLATE NOCASE").all();
  return {items:rows,total,page,limit,totalPages:Math.max(1,Math.ceil(total/limit)),actions,staff:staffRows};
});


// --- Complete backup ZIP helpers (no extra npm dependency required) ---
const ZIP_LIMIT = 250 * 1024 * 1024;

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  const now = dosDateTime();
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(now.dosTime, 10);
    local.writeUInt16LE(now.dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(now.dosTime, 12);
    central.writeUInt16LE(now.dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + compressed.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

function findZipEnd(buffer) {
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

function readZipEntries(buffer) {
  const eocd = findZipEnd(buffer);
  if (eocd < 0) throw new Error("Invalid backup ZIP: end of archive was not found.");
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error("Invalid backup ZIP: central directory is truncated.");
  const entries = [];
  let pos = centralOffset;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buffer.length || buffer.readUInt32LE(pos) !== 0x02014b50) throw new Error("Invalid backup ZIP: corrupt central directory.");
    const method = buffer.readUInt16LE(pos + 10);
    const crc = buffer.readUInt32LE(pos + 16);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const nameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localOffset = buffer.readUInt32LE(pos + 42);
    const name = buffer.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    entries.push({ name, method, crc, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractZipEntry(buffer, entry) {
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error(`Invalid backup ZIP: corrupt local header for ${entry.name}.`);
  }
  const nameLen = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLen = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLen + extraLen;
  const end = start + entry.compressedSize;
  if (start < 0 || end > buffer.length) throw new Error(`Invalid backup ZIP: truncated entry ${entry.name}.`);
  const compressed = buffer.subarray(start, end);
  let data;
  if (entry.method === 0) data = Buffer.from(compressed);
  else if (entry.method === 8) data = zlib.inflateRawSync(compressed);
  else throw new Error(`Unsupported ZIP compression for ${entry.name}.`);
  if (data.length !== entry.uncompressedSize || crc32(data) !== entry.crc) {
    throw new Error(`Invalid backup ZIP: checksum failed for ${entry.name}.`);
  }
  return data;
}

function safeZipRelativePath(name) {
  const normalized = String(name).replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) return null;
  const parts = normalized.split("/");
  if (parts.some(p => p === ".." || p === ".")) return null;
  if (normalized === "pos.sqlite") return normalized;
  if (normalized.startsWith("product-images/") && parts.length > 1) return normalized;
  return null;
}

app.get("/api/health", async () => ({ ok: true, service: "grocery-pos", database: "sqlite" }));
app.get("/api/backup/database", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const tempPath = path.join(dataDir, `pos-backup-${crypto.randomBytes(8).toString("hex")}.sqlite`);
  try {
    await db.backup(tempPath);

    const entries = [
      { name: "pos.sqlite", data: fs.readFileSync(tempPath) },
      { name: "product-images/", data: Buffer.alloc(0) }
    ];
    if (fs.existsSync(imageDir)) {
      for (const name of fs.readdirSync(imageDir)) {
        const target = path.join(imageDir, name);
        if (!fs.statSync(target).isFile()) continue;
        const relative = `product-images/${name}`;
        entries.push({ name: relative, data: fs.readFileSync(target) });
      }
    }

    const manifest = {
      format: "Grocery POS Complete Backup",
      version: APP_VERSION,
      createdAt: new Date().toISOString(),
      includes: ["pos.sqlite", "product-images/"]
    };
    entries.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });

    const zipBuffer = makeZip(entries);
    if (zipBuffer.length > ZIP_LIMIT) throw new Error("The complete backup is larger than the 250 MB limit.");
    writeAudit(request, 'Complete backup', 'Created a complete POS backup including the database and product images.');
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", `attachment; filename="grocery-pos-complete-backup-${stamp}.zip"`);
    return reply.send(zipBuffer);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ error: error.message || "Could not create the complete backup." });
  } finally {
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
  }
});

app.post("/api/backup/restore", async (request, reply) => {
  const managerAuthorized = isManagerAuthorized(request);
  if (!managerAuthorized && !requireAdmin(request, reply)) return;
  const body = request.body;
  if (!Buffer.isBuffer(body) || !body.length) return reply.code(400).send({ error: "Please upload a valid Grocery POS backup file." });
  if (body.length > 300 * 1024 * 1024) return reply.code(413).send({ error: "Backup file is too large. Maximum size is 300 MB." });

  let sqliteBuffer = body;
  let imageEntries = null;
  const isZip = body.length >= 4 && body.readUInt32LE(0) === 0x04034b50;
  if (isZip) {
    try {
      const zipEntries = readZipEntries(body);
      const selected = new Map();
      for (const entry of zipEntries) {
        const safeName = safeZipRelativePath(entry.name);
        if (!safeName) continue;
        if (safeName === "pos.sqlite" || safeName.startsWith("product-images/")) {
          selected.set(safeName, entry);
        }
      }
      if (!selected.has("pos.sqlite")) throw new Error("This ZIP does not contain a Grocery POS database (pos.sqlite).");
      sqliteBuffer = extractZipEntry(body, selected.get("pos.sqlite"));
      imageEntries = [];
      for (const [name, entry] of selected) {
        if (name.startsWith("product-images/") && name !== "product-images/") {
          imageEntries.push({ name, data: extractZipEntry(body, entry) });
        }
      }
    } catch (error) {
      return reply.code(400).send({ error: error.message || "Could not read the backup ZIP." });
    }
  } else if (body.slice(0, 16).toString("utf8") !== "SQLite format 3\0") {
    return reply.code(400).send({ error: "Please upload a Grocery POS .zip complete backup or a compatible .sqlite database backup." });
  }

  if (sqliteBuffer.length > 100 * 1024 * 1024) return reply.code(413).send({ error: "The database portion of this backup is too large. Maximum is 100 MB." });

  const tempPath = path.join(dataDir, `restore-${crypto.randomBytes(8).toString("hex")}.sqlite`);
  const tempImageDir = path.join(dataDir, `.restore-images-${crypto.randomBytes(8).toString("hex")}`);
  const oldImageDir = path.join(dataDir, `.previous-images-${crypto.randomBytes(8).toString("hex")}`);
  let source = null;
  let attached = false;
  let imageSwapDone = false;
  try {
    fs.writeFileSync(tempPath, sqliteBuffer);
    source = new Database(tempPath, { readonly: true, fileMustExist: true });
    const requiredTables = ["categories", "products", "expenses", "transactions", "transaction_items", "refunds"];
    const tableNames = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
    const missing = requiredTables.filter(name => !tableNames.has(name));
    if (missing.length) throw new Error(`This file is not a compatible Grocery POS backup. Missing: ${missing.join(", ")}.`);
    source.close();
    source = null;

    if (imageEntries) {
      fs.mkdirSync(tempImageDir, { recursive: true });
      for (const entry of imageEntries) {
        const filename = entry.name.slice("product-images/".length);
        if (!filename || filename.includes("/") || filename.includes("\\") || filename === "." || filename === "..") {
          throw new Error("The backup contains an invalid product image filename.");
        }
        if (entry.data.length > 20 * 1024 * 1024) throw new Error(`Product image ${filename} is too large.`);
        fs.writeFileSync(path.join(tempImageDir, filename), entry.data);
      }
    }

    db.exec("PRAGMA foreign_keys = OFF");
    db.prepare("ATTACH DATABASE ? AS restore_db").run(tempPath);
    attached = true;

    const baseTables = ["categories", "products", "expenses", "transactions", "transaction_items", "refunds"];
    const optionalTables = ["store_settings", "receipt_settings", "cashier_accounts", "audit_logs", "supplier_debts", "supplier_debt_items", "supplier_debt_payments"];
    const backupTableNames = tableNames;
    const tables = [...baseTables, ...optionalTables.filter(name => backupTableNames.has(name))];
    const allowSchemaMismatch = String(request.headers["x-allow-schema-mismatch"] || "").toLowerCase() === "true";
    const rejectRestore = (status, payload) => {
      try { if (attached) db.exec("DETACH DATABASE restore_db"); } catch {}
      attached = false;
      return reply.code(status).send(payload);
    };
    const restorePlans = [];
    const schemaMismatches = [];
    for (const table of tables) {
      const mainInfo = db.prepare(`PRAGMA table_info(${table})`).all();
      const backupInfo = db.prepare(`PRAGMA restore_db.table_info(${table})`).all();
      const mainCols = mainInfo.map(c => c.name);
      const backupCols = backupInfo.map(c => c.name);
      const missingInBackup = mainCols.filter(c => !backupCols.includes(c));
      const extraInBackup = backupCols.filter(c => !mainCols.includes(c));
      let cols = mainCols.filter(c => backupCols.includes(c));
      if (table === "transactions") {
        const missingRequired = ["id","transaction_number","subtotal","discount","total","cash_received","change_amount","refunded_at","refund_reason","refund_status","refunded_amount","refunded_subtotal","created_at"].filter(c => !backupCols.includes(c));
        if (missingRequired.length) {
          return rejectRestore(400, { error: `The backup schema for ${table} is missing required fields: ${missingRequired.join(", ")}.`, code: "REQUIRED_SCHEMA_MISSING" });
        }
      }
      const missingNonDefaultRequired = mainInfo
        .filter(c => c.notnull && !c.pk && c.dflt_value === null && !backupCols.includes(c.name))
        .map(c => c.name);
      if (missingNonDefaultRequired.length) {
        return rejectRestore(400, { error: `The backup schema for ${table} is missing required fields that cannot be safely filled: ${missingNonDefaultRequired.join(", ")}.`, code: "REQUIRED_SCHEMA_MISSING" });
      }
      if (missingInBackup.length || extraInBackup.length || mainCols.length !== backupCols.length) {
        schemaMismatches.push({ table, missingInBackup, extraInBackup });
      }
      if (!cols.length) return rejectRestore(400, { error: `The backup contains no compatible fields for ${table}.`, code: "NO_COMPATIBLE_COLUMNS" });
      restorePlans.push({ table, cols });
    }
    if (schemaMismatches.length && !allowSchemaMismatch) {
      return rejectRestore(409, {
        error: "The backup schema differs from the current POS version. You can continue after confirming that you want to restore it anyway.",
        code: "SCHEMA_MISMATCH",
        warning: "Only compatible columns will be restored. Newer columns in this POS will keep their default values. Columns that exist only in the backup will be ignored.",
        mismatches: schemaMismatches
      });
    }
    const transaction = db.transaction(() => {
      // Security credentials are machine-local. Never replace the destination
      // admin_auth row when restoring business data from another machine.
      for (const table of tables.slice().reverse()) db.exec(`DELETE FROM ${table}`);
      for (const { table, cols } of restorePlans) {
        const quotedCols = cols.map(c => `"${c.replace(/"/g, '""')}"`).join(", ");
        db.exec(`INSERT INTO ${table} (${quotedCols}) SELECT ${quotedCols} FROM restore_db.${table}`);
      }
      try { db.exec("DELETE FROM sqlite_sequence"); } catch {}
      for (const table of baseTables) {
        const maxId = db.prepare(`SELECT MAX(id) AS maxId FROM ${table}`).get().maxId;
        if (maxId != null) {
          const updated = db.prepare("UPDATE sqlite_sequence SET seq=? WHERE name=?").run(maxId, table);
          if (updated.changes === 0) db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES (?, ?)").run(table, maxId);
        }
      }
    });
    transaction();
    db.exec("DETACH DATABASE restore_db");
    attached = false;
    db.exec("PRAGMA foreign_keys = ON");

    // New complete backups replace the product-image directory atomically after
    // the database has been validated and restored. Legacy .sqlite backups keep
    // the current image directory for backward compatibility.
    if (imageEntries) {
      if (fs.existsSync(imageDir)) fs.renameSync(imageDir, oldImageDir);
      fs.renameSync(tempImageDir, imageDir);
      imageSwapDone = true;
      try { if (fs.existsSync(oldImageDir)) fs.rmSync(oldImageDir, { recursive: true, force: true }); } catch {}
    }

    writeAudit(request, imageEntries ? 'Complete backup restore' : 'Database restore',
      imageEntries
        ? 'Restored the POS database and product images from a complete backup.'
        : 'Restored the SQLite database from a legacy database backup.');
    activeAdminTokens.clear();
    activeCashierTokens.clear();
    return {
      ok: true,
      message: imageEntries
        ? "Complete backup restored successfully, including product images. All access sessions have been locked for security."
        : "Database restored successfully. This older database-only backup did not contain product images, so the existing image folder was kept. All access sessions have been locked for security."
    };
  } catch (error) {
    request.log.error(error);
    try { if (attached) db.exec("DETACH DATABASE restore_db"); } catch {}
    try { db.exec("PRAGMA foreign_keys = ON"); } catch {}
    if (!imageSwapDone && fs.existsSync(tempImageDir)) {
      try { fs.rmSync(tempImageDir, { recursive: true, force: true }); } catch {}
    }
    return reply.code(400).send({ error: error.message || "Could not restore the backup." });
  } finally {
    try { if (source) source.close(); } catch {}
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    if (fs.existsSync(tempImageDir)) {
      try { fs.rmSync(tempImageDir, { recursive: true, force: true }); } catch {}
    }
  }
});


app.get("/api/categories", async () => db.prepare("SELECT id, name, sort_order AS sortOrder FROM categories ORDER BY sort_order, name").all());

app.post("/api/categories", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const name = String(request.body?.name || "").trim();
  if (!name) return reply.code(400).send({ error: "Category name is required." });
  try {
    const result = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)").run(name, 999);
    writeAudit(request, 'Category created', `Created category ${name}.`);
    return reply.code(201).send({ id: Number(result.lastInsertRowid), name });
  } catch {
    return reply.code(409).send({ error: "That category already exists." });
  }
});

app.get("/api/products", async () => productRows());

app.get("/api/products/barcode/:barcode", async (request, reply) => {
  const barcode = decodeURIComponent(String(request.params.barcode || "")).trim();
  if (!barcode) return reply.code(400).send({ error: "Barcode is required." });
  const product = productRows().find(p => !p.isDeleted && p.isAvailable && String(p.barcode || "") === barcode);
  if (!product) return reply.code(404).send({ error: `Barcode ${barcode} was not found.` });
  return product;
});

app.post("/api/products", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const b = request.body || {};
  const name = String(b.name || "").trim();
  const unit = b.unit === "piece" ? "piece" : "kg";
  const retail = Number(b.retail);
  const wholesale = Number(b.wholesale);
  const costPrice = Number(b.costPrice);
  const barcode = String(b.barcode || "").trim().slice(0, 64);
  const emoji = String(b.emoji || "🛒").trim() || "🛒";
  const imageData = typeof b.imageData === "string" ? b.imageData : "";
  const categoryId = b.categoryId ? Number(b.categoryId) : null;

  if (!name || !Number.isFinite(retail) || !Number.isFinite(wholesale) || !Number.isFinite(costPrice) || retail < 0 || wholesale < 0 || costPrice < 0) {
    return reply.code(400).send({ error: "Name and valid non-negative prices are required." });
  }

  let result;
  try {
    result = db.prepare(`
      INSERT INTO products (name, unit, retail_price, wholesale_price, cost_price, barcode, emoji, image_data, category_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(name, unit, retail, wholesale, costPrice, barcode || null, emoji, categoryId);
  } catch (err) {
    if (String(err.message || "").includes("idx_products_barcode_active") || String(err.message || "").includes("UNIQUE constraint failed: products.barcode")) {
      return reply.code(409).send({ error: "That barcode is already assigned to another active product." });
    }
    throw err;
  }
  const id = Number(result.lastInsertRowid);
  try {
    if (imageData) {
      const imageUrl = saveProductImage(id, imageData);
      db.prepare("UPDATE products SET image_data=? WHERE id=?").run(imageUrl, id);
    }
  } catch (err) {
    db.prepare("DELETE FROM products WHERE id=?").run(id);
    return reply.code(400).send({ error: err.message || "Could not save product image." });
  }
  writeAudit(request, 'Product created', `Created product ${name}.`, { productId: id });
  return reply.code(201).send(productRows().find(p => p.id === id));
});

app.put("/api/products/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id = Number(request.params.id);
  const existing = db.prepare("SELECT * FROM products WHERE id=?").get(id);
  if (!existing) return reply.code(404).send({ error: "Product not found." });
  const b = request.body || {};
  const name = String(b.name || "").trim();
  const unit = b.unit === "piece" ? "piece" : "kg";
  const retail = Number(b.retail);
  const wholesale = Number(b.wholesale);
  const costPrice = Number(b.costPrice);
  const barcode = String(b.barcode || "").trim().slice(0, 64);
  const emoji = String(b.emoji || "🛒").trim() || "🛒";
  const hasImageField = Object.prototype.hasOwnProperty.call(b, "imageData");
  const requestedImage = typeof b.imageData === "string" ? b.imageData : "";
  const categoryId = b.categoryId ? Number(b.categoryId) : null;
  const isAvailable = b.isAvailable === false ? 0 : 1;

  if (!name || !Number.isFinite(retail) || !Number.isFinite(wholesale) || !Number.isFinite(costPrice) || retail < 0 || wholesale < 0 || costPrice < 0) {
    return reply.code(400).send({ error: "Name and valid non-negative prices are required." });
  }

  let imageData = existing.image_data;
  try {
    if (hasImageField && requestedImage === "") {
      deleteProductImageFile(existing.image_data);
      imageData = null;
    } else if (hasImageField && requestedImage.startsWith("data:image/")) {
      imageData = saveProductImage(id, requestedImage);
      if (existing.image_data !== imageData) deleteProductImageFile(existing.image_data);
    }
  } catch (err) {
    return reply.code(400).send({ error: err.message || "Could not save product image." });
  }

  let result;
  try {
    result = db.prepare(`
      UPDATE products
      SET name=?, unit=?, retail_price=?, wholesale_price=?, cost_price=?, barcode=?, emoji=?, image_data=?, category_id=?, is_available=?, deleted_at=NULL, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, unit, retail, wholesale, costPrice, barcode || null, emoji, imageData, categoryId, isAvailable, id);
  } catch (err) {
    if (String(err.message || "").includes("idx_products_barcode_active") || String(err.message || "").includes("UNIQUE constraint failed: products.barcode")) {
      return reply.code(409).send({ error: "That barcode is already assigned to another active product." });
    }
    throw err;
  }

  if (!result.changes) return reply.code(404).send({ error: "Product not found." });
  writeAudit(request, 'Product updated', `Updated product ${name}.`, { productId: id });
  return productRows().find(p => p.id === id);
});

app.delete("/api/products/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id = Number(request.params.id);
  const product = db.prepare("SELECT name FROM products WHERE id=?").get(id);
  const result = db.prepare("UPDATE products SET is_available=0, deleted_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=? AND deleted_at IS NULL").run(id);
  if (!result.changes) return reply.code(404).send({ error: "Product not found or already deleted." });
  writeAudit(request, 'Product deleted', `Deleted product ${product?.name || id}.`, { productId: id });
  return { ok: true };
});

app.get("/api/transactions", async (request) => {
  const q = String(request.query?.q || "").trim();
  const date = String(request.query?.date || "all");
  const page = Math.max(Number(request.query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(request.query?.limit) || 25, 1), 100);
  const params = [];
  const where = [];
  if (q) {
    where.push(`(t.transaction_number LIKE ? OR EXISTS (SELECT 1 FROM transaction_items ti WHERE ti.transaction_id=t.id AND ti.product_name LIKE ?))`);
    params.push(`%${q}%`, `%${q}%`);
  }
  if (date === "today") where.push("date(t.created_at)=date('now','localtime')");
  if (date === "yesterday") where.push("date(t.created_at)=date('now','localtime','-1 day')");
  if (date === "7days") where.push("datetime(t.created_at) >= datetime('now','localtime','-6 days')");
  if (date === "month") where.push("strftime('%Y-%m', t.created_at)=strftime('%Y-%m','now','localtime')");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db.prepare(`SELECT COUNT(*) AS count FROM transactions t ${whereSql}`).get(...params).count;
  const offset = (page - 1) * limit;
  const rows = db.prepare(`
    SELECT t.id, t.transaction_number AS transactionNumber, t.subtotal, t.discount, t.total,
           t.cash_received AS cashReceived, t.change_amount AS changeAmount, t.cashier_id AS cashierId, t.cashier_name AS cashierName, t.refunded_at AS refundedAt, t.refund_reason AS refundReason, t.refund_status AS refundStatus, t.refunded_amount AS refundedAmount, t.refunded_subtotal AS refundedSubtotal, t.created_at AS createdAt
    FROM transactions t ${whereSql}
    ORDER BY t.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  return {
    items: rows.map(row => ({
      ...row,
      items: db.prepare(`SELECT id, product_id AS productId, product_name AS name, unit, price_type AS priceType, unit_price AS unitPrice, cost_price AS costPrice, quantity, total, refunded_quantity AS refundedQuantity, refunded_total AS refundedTotal FROM transaction_items WHERE transaction_id=? ORDER BY id`).all(row.id)
    })),
    total: Number(total), page, limit, totalPages: Math.max(1, Math.ceil(Number(total) / limit))
  };
});

app.post("/api/transactions", async (request, reply) => {
  const session = requireCashierOrAdmin(request, reply);
  if (!session) return;
  const b = request.body || {};
  const items = Array.isArray(b.items) ? b.items : [];
  const subtotal = Number(b.subtotal);
  const discount = Number(b.discount) || 0;
  const total = Number(b.total);
  const cashReceived = Number(b.cashReceived);

  if (!items.length || !Number.isFinite(subtotal) || !Number.isFinite(total) || !Number.isFinite(cashReceived)) {
    return reply.code(400).send({ error: "A valid sale with at least one item is required." });
  }
  if (discount < 0 || discount > subtotal) return reply.code(400).send({ error: "Invalid discount." });
  if (total < 0 || Math.abs(total - (subtotal - discount)) > 0.01) return reply.code(400).send({ error: "Sale total is invalid." });
  if (cashReceived < total) return reply.code(400).send({ error: "Cash received is less than the total." });

  const nextNumber = db.prepare("SELECT COALESCE(MAX(id),0)+1 AS n FROM transactions").get().n;
  const transactionNumber = `TX-${String(nextNumber).padStart(6, "0")}`;
  const changeAmount = cashReceived - total;

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (transaction_number, subtotal, discount, total, cash_received, change_amount, cashier_id, cashier_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO transaction_items
      (transaction_id, product_id, product_name, unit, price_type, unit_price, cost_price, quantity, total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const create = db.transaction(() => {
    const tx = insertTransaction.run(transactionNumber, subtotal, discount, total, cashReceived, changeAmount, session.role === 'cashier' ? session.cashier.id : null, session.role === 'cashier' ? session.cashier.name : 'Owner');
    for (const item of items) {
      const product = item.productId ? db.prepare("SELECT name, unit, cost_price FROM products WHERE id=?").get(Number(item.productId)) : null;
      insertItem.run(
        tx.lastInsertRowid,
        item.productId || null,
        String(product?.name || item.name || "Unknown product"),
        product?.unit === "piece" ? "piece" : (item.unit === "piece" ? "piece" : "kg"),
        item.priceType === "wholesale" ? "wholesale" : "retail",
        Number(item.unitPrice),
        Number(product?.cost_price || item.costPrice || 0),
        Number(item.quantity),
        Number(item.total)
      );
    }
    return Number(tx.lastInsertRowid);
  });

  const id = create();
  const sale = db.prepare(`
    SELECT id, transaction_number AS transactionNumber, subtotal, discount, total,
           cash_received AS cashReceived, change_amount AS changeAmount, cashier_id AS cashierId, cashier_name AS cashierName, created_at AS createdAt
    FROM transactions WHERE id=?
  `).get(id);
  sale.items = db.prepare(`
    SELECT id, product_id AS productId, product_name AS name, unit,
           price_type AS priceType, unit_price AS unitPrice, cost_price AS costPrice, quantity, total
    FROM transaction_items WHERE transaction_id=? ORDER BY id
  `).all(id);

  writeAudit(request, 'Transaction completed', `${sale.transactionNumber} completed for ${sale.total.toFixed(2)}.`, { transactionId: id }, session.role === 'cashier' ? {type:'cashier',id:session.cashier.id,name:session.cashier.name} : {type:'owner',id:null,name:'Owner'});
  return reply.code(201).send(sale);
});

app.post("/api/transactions/:id/refund", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "Invalid transaction." });
  const existing = db.prepare(`
    SELECT id, transaction_number AS transactionNumber, subtotal, discount, total,
           refunded_at AS refundedAt, refund_status AS refundStatus,
           COALESCE(refunded_amount,0) AS refundedAmount, COALESCE(refunded_subtotal,0) AS refundedSubtotal
    FROM transactions WHERE id=?
  `).get(id);
  if (!existing) return reply.code(404).send({ error: "Transaction not found." });
  if (existing.refundStatus === "full" || existing.refundedAt) return reply.code(409).send({ error: "This transaction has already been fully refunded." });

  const bodyItems = Array.isArray(request.body?.items) ? request.body.items : [];
  const reason = String(request.body?.reason || "Customer refund").trim().slice(0, 200) || "Customer refund";
  const items = db.prepare(`SELECT id, quantity, unit_price AS unitPrice, total, refunded_quantity AS refundedQuantity FROM transaction_items WHERE transaction_id=? ORDER BY id`).all(id);
  if (!bodyItems.length) return reply.code(400).send({ error: "Select at least one item quantity to refund." });

  const requested = new Map();
  for (const item of bodyItems) {
    const itemId = Number(item.transactionItemId ?? item.id);
    const qty = Number(item.quantity);
    if (!Number.isInteger(itemId) || itemId < 1 || !Number.isFinite(qty) || qty <= 0) continue;
    requested.set(itemId, (requested.get(itemId) || 0) + qty);
  }
  if (!requested.size) return reply.code(400).send({ error: "Select at least one valid quantity to refund." });

  const itemById = new Map(items.map(x => [x.id, x]));
  const factor = existing.subtotal > 0 ? Math.max(0, Math.min(1, (existing.subtotal - existing.discount) / existing.subtotal)) : 1;
  const updates = [];
  let refundSubtotal = 0;
  let refundAmount = 0;
  for (const [itemId, requestedQty] of requested) {
    const item = itemById.get(itemId);
    if (!item) return reply.code(400).send({ error: "One of the selected receipt items could not be found." });
    const remaining = Math.max(0, Number(item.quantity) - Number(item.refundedQuantity || 0));
    if (requestedQty > remaining + 1e-9) return reply.code(400).send({ error: `Refund quantity for item ${itemId} exceeds the remaining quantity.` });
    if (item.quantity % 1 === 0 && !Number.isInteger(requestedQty)) return reply.code(400).send({ error: `Refund quantity for item ${itemId} must be a whole number.` });
    const precision = item.quantity % 1 === 0 ? 0 : 6;
    const qty = Math.round(requestedQty * (10 ** precision)) / (10 ** precision);
    if (qty <= 0 || qty > remaining + 1e-9) return reply.code(400).send({ error: `Refund quantity for item ${itemId} exceeds the remaining quantity.` });
    const gross = qty * Number(item.unitPrice);
    const net = gross * factor;
    updates.push({ itemId, qty, net });
    refundSubtotal += gross;
    refundAmount += net;
  }
  if (refundAmount <= 0.000001) return reply.code(400).send({ error: "The selected refund amount must be greater than zero." });

  const tx = db.transaction(() => {
    for (const u of updates) {
      db.prepare(`UPDATE transaction_items SET refunded_quantity=refunded_quantity+?, refunded_total=refunded_total+? WHERE id=?`).run(u.qty, u.net, u.itemId);
    }
    const newRefundedAmount = Math.min(Number(existing.total), Number(existing.refundedAmount || 0) + refundAmount);
    const newRefundedSubtotal = Math.min(Number(existing.subtotal), Number(existing.refundedSubtotal || 0) + refundSubtotal);
    const allRefunded = items.every(item => {
      const added = updates.find(u => u.itemId === item.id)?.qty || 0;
      return Number(item.quantity) - Number(item.refundedQuantity || 0) - added <= 0.000001;
    });
    const status = allRefunded ? "full" : "partial";
    db.prepare(`UPDATE transactions SET refunded_amount=?, refunded_subtotal=?, refund_status=?, refunded_at=?, refund_reason=? WHERE id=?`).run(
      newRefundedAmount, newRefundedSubtotal, status, allRefunded ? new Date().toISOString().slice(0,19).replace('T',' ') : null, reason, id
    );
    db.prepare(`INSERT INTO refunds (transaction_id, amount, subtotal_amount, reason) VALUES (?,?,?,?)`).run(id, refundAmount, refundSubtotal, reason);
  });
  try { tx(); } catch (err) { return reply.code(400).send({ error: err.message || "Could not process refund." }); }

  const sale = db.prepare(`
    SELECT id, transaction_number AS transactionNumber, subtotal, discount, total,
           cash_received AS cashReceived, change_amount AS changeAmount, refunded_at AS refundedAt,
           refund_reason AS refundReason, refund_status AS refundStatus, refunded_amount AS refundedAmount,
           refunded_subtotal AS refundedSubtotal, created_at AS createdAt
    FROM transactions WHERE id=?
  `).get(id);
  sale.items = db.prepare(`
    SELECT id, product_id AS productId, product_name AS name, unit, price_type AS priceType,
           unit_price AS unitPrice, cost_price AS costPrice, quantity, total,
           refunded_quantity AS refundedQuantity, refunded_total AS refundedTotal
    FROM transaction_items WHERE transaction_id=? ORDER BY id
  `).all(id);
  writeAudit(request, 'Refund authorized', `${sale.transactionNumber}: refund of ${Number(refundAmount).toFixed(2)} authorized by Owner.`, { transactionId: id });
  return sale;
});

app.get("/api/dashboard", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const requested = Number(request.query?.days) || 30;
  const days = [1, 7, 30, 365].includes(requested) ? requested : 30;
  const start = `-${days - 1} days`;
  const prevStart = `-${days * 2 - 1} days`;
  const prevEnd = `-${days} days`;
  const metrics = db.prepare(`
    SELECT
      COALESCE(SUM(total - COALESCE(refunded_amount,0)),0) AS netSales,
      COALESCE(SUM(subtotal - COALESCE(refunded_subtotal,0)),0) AS grossSales,
      COALESCE(SUM(discount - MAX(0, COALESCE(refunded_subtotal,0) - COALESCE(refunded_amount,0))),0) AS discounts,
      COUNT(*) AS transactions,
      COALESCE(AVG(total - COALESCE(refunded_amount,0)),0) AS averageSale
    FROM transactions
    WHERE (refund_status IS NULL OR refund_status != 'full') AND datetime(created_at) >= datetime('now','localtime',?)
  `).get(start);
  const cogs = db.prepare(`
    SELECT COALESCE(SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS cogs
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE (t.refund_status IS NULL OR t.refund_status != 'full') AND datetime(t.created_at) >= datetime('now','localtime',?)
  `).get(start).cogs;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date(expense_date) >= date('now','localtime',?)`).get(start).total;
  const previous = db.prepare(`
    SELECT COALESCE(SUM(total - COALESCE(refunded_amount,0)),0) AS netSales, COUNT(*) AS transactions
    FROM transactions
    WHERE (refund_status IS NULL OR refund_status != 'full') AND datetime(created_at) >= datetime('now','localtime',?) AND datetime(created_at) < datetime('now','localtime',?)
  `).get(prevStart, prevEnd);
  const daily = db.prepare(`
    SELECT date(created_at) AS date, COALESCE(SUM(total - COALESCE(refunded_amount,0)),0) AS sales, COUNT(*) AS transactions
    FROM transactions
    WHERE (refund_status IS NULL OR refund_status != 'full') AND datetime(created_at) >= datetime('now','localtime',?)
    GROUP BY date(created_at) ORDER BY date(created_at)
  `).all(start);
  const topProducts = db.prepare(`
    SELECT ti.product_id AS productId, ti.product_name AS name, ti.unit,
           SUM(ti.quantity - COALESCE(ti.refunded_quantity,0)) AS quantity, SUM(ti.total - COALESCE(ti.refunded_total,0)) AS sales,
           SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))) AS cogs,
           SUM((ti.total - COALESCE(ti.refunded_total,0)) - ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))) AS grossProfit
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE (t.refund_status IS NULL OR t.refund_status != 'full') AND datetime(t.created_at) >= datetime('now','localtime',?)
    GROUP BY ti.product_id, ti.product_name, ti.unit
    ORDER BY sales DESC LIMIT 10
  `).all(start);
  const expenseRows = db.prepare(`
    SELECT id, expense_date AS date, category, description, amount
    FROM expenses WHERE date(expense_date) >= date('now','localtime',?)
    ORDER BY expense_date DESC, id DESC LIMIT 50
  `).all(start);
  const unknownCostItems = db.prepare(`
    SELECT COUNT(*) AS count FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE (t.refund_status IS NULL OR t.refund_status != 'full') AND datetime(t.created_at) >= datetime('now','localtime',?) AND COALESCE(ti.cost_price,0)=0 AND (ti.quantity - COALESCE(ti.refunded_quantity,0)) > 0
  `).get(start).count;
  return {
    days,
    metrics: { ...metrics, cogs: Number(cogs), grossProfit: Number(metrics.netSales) - Number(cogs), expenses: Number(expenses), netProfit: Number(metrics.netSales) - Number(cogs) - Number(expenses), margin: Number(metrics.netSales) ? ((Number(metrics.netSales)-Number(cogs))/Number(metrics.netSales))*100 : 0 },
    previous: { netSales: Number(previous.netSales), transactions: Number(previous.transactions) },
    daily: daily.map(x => ({...x, sales:Number(x.sales), transactions:Number(x.transactions)})),
    topProducts: topProducts.map(x => ({...x, quantity:Number(x.quantity), sales:Number(x.sales), cogs:Number(x.cogs), grossProfit:Number(x.grossProfit)})),
    expenses: expenseRows.map(x => ({...x, amount:Number(x.amount)})),
    unknownCostItems: Number(unknownCostItems)
  };
});

app.get("/api/dashboard-series", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const granularity = String(request.query?.granularity || "daily").toLowerCase();
  const configs = {
    daily:   { start: "-29 days",  group: "date(created_at)", label: "date(created_at)", limit: 30 },
    weekly:  { start: "-83 days",  group: "strftime('%Y-%W', created_at)", label: "strftime('%Y-%W', created_at)", limit: 12 },
    monthly: { start: "-364 days", group: "strftime('%Y-%m', created_at)", label: "strftime('%Y-%m', created_at)", limit: 12 },
    yearly:  { start: "-4 years", group: "strftime('%Y', created_at)", label: "strftime('%Y', created_at)", limit: 5 }
  };
  const cfg = configs[granularity] || configs.daily;
  let rows;
  if (granularity === "weekly") {
    rows = db.prepare(`
      SELECT strftime('%Y-%W', created_at) AS bucket,
             date(created_at, '-' || ((CAST(strftime('%w', created_at) AS INTEGER) + 6) % 7) || ' days') AS startDate,
             COALESCE(SUM(total - COALESCE(refunded_amount,0)),0) AS sales, COUNT(*) AS transactions
      FROM transactions
      WHERE (refund_status IS NULL OR refund_status != 'full') AND datetime(created_at) >= datetime('now','localtime',?)
      GROUP BY bucket ORDER BY bucket
    `).all(cfg.start);
  } else {
    rows = db.prepare(`
      SELECT ${cfg.label} AS bucket, COALESCE(SUM(total - COALESCE(refunded_amount,0)),0) AS sales, COUNT(*) AS transactions
      FROM transactions
      WHERE (refund_status IS NULL OR refund_status != 'full') AND datetime(created_at) >= datetime('now','localtime',?)
      GROUP BY ${cfg.group} ORDER BY bucket
    `).all(cfg.start);
  }
  return {
    granularity,
    items: rows.slice(-cfg.limit).map(x => ({
      bucket: x.bucket,
      startDate: x.startDate || x.bucket,
      sales: Number(x.sales),
      transactions: Number(x.transactions)
    }))
  };
});

app.get("/api/top-products", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const period = String(request.query?.period || "monthly").toLowerCase();
  const configs = {
    daily: "-0 days",
    weekly: "-6 days",
    monthly: "-29 days",
    yearly: "-364 days"
  };
  const start = configs[period] || configs.monthly;
  const rows = db.prepare(`
    SELECT ti.product_id AS productId, ti.product_name AS name, ti.unit,
           COALESCE(SUM(ti.quantity),0) AS quantity,
           COALESCE(SUM(ti.total),0) AS sales,
           COALESCE(SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS cogs,
           COALESCE(SUM((ti.total - COALESCE(ti.refunded_total,0)) - ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS grossProfit,
           COUNT(DISTINCT t.id) AS transactions
    FROM transaction_items ti
    JOIN transactions t ON t.id=ti.transaction_id
    WHERE t.refunded_at IS NULL
      AND datetime(t.created_at) >= datetime('now','localtime',?)
    GROUP BY ti.product_id, ti.product_name, ti.unit
    ORDER BY sales DESC, quantity DESC, name COLLATE NOCASE
    LIMIT 100
  `).all(start);
  return {
    period: period in configs ? period : "monthly",
    items: rows.map(x => ({
      ...x,
      quantity: Number(x.quantity), sales: Number(x.sales), cogs: Number(x.cogs),
      grossProfit: Number(x.grossProfit), transactions: Number(x.transactions)
    }))
  };
});

app.get("/api/product-performance-list", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const period = String(request.query?.period || "monthly").toLowerCase();
  const configs = { daily: "-0 days", weekly: "-6 days", monthly: "-29 days", yearly: "-364 days" };
  const start = configs[period] || configs.monthly;
  const q = String(request.query?.q || "").trim();
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT p.id AS productId, p.name, p.unit, p.deleted_at AS deletedAt,
           COALESCE(SUM(CASE WHEN (t.refund_status IS NULL OR t.refund_status != 'full')
             THEN ti.quantity - COALESCE(ti.refunded_quantity,0) ELSE 0 END),0) AS quantity,
           COALESCE(SUM(CASE WHEN (t.refund_status IS NULL OR t.refund_status != 'full')
             THEN ti.total - COALESCE(ti.refunded_total,0) ELSE 0 END),0) AS sales,
           COALESCE(SUM(CASE WHEN (t.refund_status IS NULL OR t.refund_status != 'full')
             THEN ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0)) ELSE 0 END),0) AS cogs,
           COALESCE(SUM(CASE WHEN (t.refund_status IS NULL OR t.refund_status != 'full')
             THEN (ti.total - COALESCE(ti.refunded_total,0)) - ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0)) ELSE 0 END),0) AS grossProfit,
           COUNT(DISTINCT CASE WHEN (t.refund_status IS NULL OR t.refund_status != 'full')
             AND (ti.quantity - COALESCE(ti.refunded_quantity,0)) > 0 THEN t.id END) AS transactions
    FROM products p
    LEFT JOIN transaction_items ti ON ti.product_id=p.id
    LEFT JOIN transactions t ON t.id=ti.transaction_id
      AND datetime(t.created_at) >= datetime('now','localtime',?)
    WHERE p.name LIKE ?
    GROUP BY p.id, p.name, p.unit, p.deleted_at
    ORDER BY sales DESC, p.name COLLATE NOCASE
  `).all(start, like);
  return { period: configs[period] ? period : "monthly", query:q, items: rows.map(x => ({ ...x, quantity:Number(x.quantity), sales:Number(x.sales), cogs:Number(x.cogs), grossProfit:Number(x.grossProfit), transactions:Number(x.transactions), isDeleted:Boolean(x.deletedAt) })) };
});

app.get("/api/product-performance/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const productId = Number(request.params.id);
  if (!Number.isInteger(productId) || productId < 1) return reply.code(400).send({ error: "Invalid product." });
  const granularity = String(request.query?.granularity || "monthly").toLowerCase();
  const configs = {
    daily:   { start: "-29 days", group: "date(t.created_at)" },
    weekly:  { start: "-83 days", group: "strftime('%Y-%W', t.created_at)" },
    monthly: { start: "-364 days", group: "strftime('%Y-%m', t.created_at)" },
    yearly:  { start: "-4 years", group: "strftime('%Y', t.created_at)" }
  };
  const cfg = configs[granularity] || configs.monthly;
  const product = db.prepare(`
    SELECT p.id, p.name, p.unit, p.retail_price AS retailPrice, p.wholesale_price AS wholesalePrice,
           p.cost_price AS costPrice, p.emoji, p.deleted_at AS deletedAt
    FROM products p WHERE p.id=?
  `).get(productId);
  const snapshot = db.prepare(`
    SELECT ti.product_id AS productId, ti.product_name AS name, ti.unit,
           COALESCE(SUM(ti.quantity - COALESCE(ti.refunded_quantity,0)),0) AS quantity, COALESCE(SUM(ti.total - COALESCE(ti.refunded_total,0)),0) AS sales,
           COALESCE(SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS cogs,
           COALESCE(SUM((ti.total - COALESCE(ti.refunded_total,0)) - ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS grossProfit,
           COUNT(DISTINCT t.id) AS transactions
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ti.product_id=? AND (t.refund_status IS NULL OR t.refund_status != 'full')
      AND datetime(t.created_at) >= datetime('now','localtime',?)
    GROUP BY ti.product_id, ti.product_name, ti.unit
  `).get(productId, cfg.start);
  const series = db.prepare(`
    SELECT ${cfg.group} AS bucket, COALESCE(SUM(ti.quantity),0) AS quantity,
           COALESCE(SUM(ti.total),0) AS sales,
           COALESCE(SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS cogs,
           COUNT(DISTINCT t.id) AS transactions
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ti.product_id=? AND (t.refund_status IS NULL OR t.refund_status != 'full')
      AND datetime(t.created_at) >= datetime('now','localtime',?)
    GROUP BY ${cfg.group} ORDER BY bucket
  `).all(productId, cfg.start);
  const types = db.prepare(`
    SELECT ti.price_type AS priceType, COALESCE(SUM(ti.quantity),0) AS quantity,
           COALESCE(SUM(ti.total),0) AS sales
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ti.product_id=? AND (t.refund_status IS NULL OR t.refund_status != 'full')
      AND datetime(t.created_at) >= datetime('now','localtime',?)
    GROUP BY ti.price_type ORDER BY sales DESC
  `).all(productId, cfg.start);
  return {
    product,
    granularity,
    summary: snapshot ? { ...snapshot, quantity:Number(snapshot.quantity), sales:Number(snapshot.sales), cogs:Number(snapshot.cogs), grossProfit:Number(snapshot.grossProfit), transactions:Number(snapshot.transactions) } : { name: product?.name || "Product", unit: product?.unit || "piece", quantity:0, sales:0, cogs:0, grossProfit:0, transactions:0 },
    series: series.map(x => ({ ...x, quantity:Number(x.quantity), sales:Number(x.sales), cogs:Number(x.cogs), transactions:Number(x.transactions) })),
    priceTypes: types.map(x => ({ ...x, quantity:Number(x.quantity), sales:Number(x.sales) }))
  };
});


app.get("/api/sales-reports", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const start = String(request.query?.start || "").trim();
  const end = String(request.query?.end || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
    return reply.code(400).send({ error: "Valid start and end dates are required." });
  }
  const from = `${start} 00:00:00`;
  const to = `${end} 23:59:59`;
  const active = `(t.refund_status IS NULL OR t.refund_status != 'full')`;
  const metrics = db.prepare(`
    SELECT
      COALESCE(SUM(t.subtotal),0) AS grossSales,
      COALESCE(SUM(t.discount),0) AS discounts,
      COALESCE(SUM(t.refunded_amount),0) AS refunds,
      COALESCE(SUM(t.total - COALESCE(t.refunded_amount,0)),0) AS netSales,
      COUNT(*) AS transactions,
      COALESCE(AVG(t.total - COALESCE(t.refunded_amount,0)),0) AS averageSale,
      COALESCE(SUM(CASE WHEN t.refund_status='full' THEN 1 ELSE 0 END),0) AS fullRefunds,
      COALESCE(SUM(CASE WHEN t.refund_status='partial' THEN 1 ELSE 0 END),0) AS partialRefunds
    FROM transactions t
    WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
  `).get(from, to);
  const refundEvents = db.prepare(`SELECT COUNT(*) AS count FROM refunds WHERE datetime(created_at) BETWEEN datetime(?) AND datetime(?)`).get(from,to).count;
  const cogs = db.prepare(`
    SELECT COALESCE(SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS cogs
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ${active} AND datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
  `).get(from,to).cogs;
  const expenses = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)`).get(start,end).total;
  const daily = db.prepare(`
    SELECT date(t.created_at) AS date,
      COALESCE(SUM(t.subtotal),0) AS grossSales,
      COALESCE(SUM(t.refunded_amount),0) AS refunds,
      COALESCE(SUM(t.total - COALESCE(t.refunded_amount,0)),0) AS netSales,
      COUNT(*) AS transactions
    FROM transactions t
    WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
    GROUP BY date(t.created_at) ORDER BY date(t.created_at)
  `).all(from,to);
  const products = db.prepare(`
    SELECT ti.product_id AS productId, ti.product_name AS name, ti.unit,
      COALESCE(SUM(CASE WHEN ${active} THEN ti.quantity-COALESCE(ti.refunded_quantity,0) ELSE 0 END),0) AS quantity,
      COALESCE(SUM(CASE WHEN ${active} THEN ti.total-COALESCE(ti.refunded_total,0) ELSE 0 END),0) AS sales,
      COALESCE(SUM(CASE WHEN ${active} THEN ti.cost_price*(ti.quantity-COALESCE(ti.refunded_quantity,0)) ELSE 0 END),0) AS cogs,
      COALESCE(SUM(CASE WHEN ${active} THEN (ti.total-COALESCE(ti.refunded_total,0))-ti.cost_price*(ti.quantity-COALESCE(ti.refunded_quantity,0)) ELSE 0 END),0) AS grossProfit,
      COUNT(DISTINCT CASE WHEN ${active} AND (ti.quantity-COALESCE(ti.refunded_quantity,0))>0 THEN t.id END) AS transactions
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
    GROUP BY ti.product_id, ti.product_name, ti.unit ORDER BY sales DESC, name COLLATE NOCASE
  `).all(from,to);
  const categories = db.prepare(`
    SELECT COALESCE(c.name,'Uncategorized') AS category,
      COALESCE(SUM(CASE WHEN ${active} THEN ti.total-COALESCE(ti.refunded_total,0) ELSE 0 END),0) AS sales,
      COUNT(DISTINCT CASE WHEN ${active} AND (ti.quantity-COALESCE(ti.refunded_quantity,0))>0 THEN t.id END) AS transactions
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    LEFT JOIN products p ON p.id=ti.product_id LEFT JOIN categories c ON c.id=p.category_id
    WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
    GROUP BY category ORDER BY sales DESC, category COLLATE NOCASE
  `).all(from,to);
  const priceTypes = db.prepare(`
    SELECT ti.price_type AS priceType,
      COALESCE(SUM(CASE WHEN ${active} THEN ti.quantity-COALESCE(ti.refunded_quantity,0) ELSE 0 END),0) AS quantity,
      COALESCE(SUM(CASE WHEN ${active} THEN ti.total-COALESCE(ti.refunded_total,0) ELSE 0 END),0) AS sales
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
    GROUP BY ti.price_type ORDER BY ti.price_type
  `).all(from,to);
  // Build a same-length previous period so the report can show descriptive period-over-period changes.
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const periodDays = Math.round((endDate - startDate) / 86400000) + 1;
  const previousEndDate = new Date(startDate); previousEndDate.setDate(previousEndDate.getDate() - 1);
  const previousStartDate = new Date(previousEndDate); previousStartDate.setDate(previousStartDate.getDate() - periodDays + 1);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const previousStart = iso(previousStartDate);
  const previousEnd = iso(previousEndDate);
  const previousFrom = `${previousStart} 00:00:00`;
  const previousTo = `${previousEnd} 23:59:59`;
  const previousBase = db.prepare(`
    SELECT COALESCE(SUM(t.subtotal),0) AS grossSales, COALESCE(SUM(t.discount),0) AS discounts,
      COALESCE(SUM(t.refunded_amount),0) AS refunds, COALESCE(SUM(t.total-COALESCE(t.refunded_amount,0)),0) AS netSales, COUNT(*) AS transactions
    FROM transactions t WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
  `).get(previousFrom, previousTo);
  const previousCogs = db.prepare(`
    SELECT COALESCE(SUM(ti.cost_price*(ti.quantity-COALESCE(ti.refunded_quantity,0))),0) AS cogs
    FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
    WHERE ${active} AND datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
  `).get(previousFrom, previousTo).cogs;
  const previousExpenses = db.prepare(`SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE date(expense_date) BETWEEN date(?) AND date(?)`).get(previousStart, previousEnd).total;
  const previousMetrics = {
    grossSales:Number(previousBase.grossSales), discounts:Number(previousBase.discounts), refunds:Number(previousBase.refunds),
    netSales:Number(previousBase.netSales), transactions:Number(previousBase.transactions), cogs:Number(previousCogs),
    grossProfit:Number(previousBase.netSales)-Number(previousCogs), expenses:Number(previousExpenses),
    netProfit:Number(previousBase.netSales)-Number(previousCogs)-Number(previousExpenses)
  };

  const m = {
    grossSales:Number(metrics.grossSales), discounts:Number(metrics.discounts), refunds:Number(metrics.refunds),
    netSales:Number(metrics.netSales), transactions:Number(metrics.transactions), averageSale:Number(metrics.averageSale),
    cogs:Number(cogs), grossProfit:Number(metrics.netSales)-Number(cogs), expenses:Number(expenses),
    netProfit:Number(metrics.netSales)-Number(cogs)-Number(expenses),
    margin:Number(metrics.netSales) ? ((Number(metrics.netSales)-Number(cogs))/Number(metrics.netSales))*100 : 0,
    refundEvents:Number(refundEvents), fullRefunds:Number(metrics.fullRefunds), partialRefunds:Number(metrics.partialRefunds)
  };
  return {
    start, end, metrics:m,
    comparison:{ start:previousStart, end:previousEnd, metrics:previousMetrics },
    daily:daily.map(x=>({...x,grossSales:Number(x.grossSales),refunds:Number(x.refunds),netSales:Number(x.netSales),transactions:Number(x.transactions)})),
    products:products.map(x=>({...x,quantity:Number(x.quantity),sales:Number(x.sales),cogs:Number(x.cogs),grossProfit:Number(x.grossProfit),transactions:Number(x.transactions)})),
    categories:categories.map(x=>({...x,sales:Number(x.sales),transactions:Number(x.transactions)})),
    priceTypes:priceTypes.map(x=>({...x,quantity:Number(x.quantity),sales:Number(x.sales)}))
  };
});


app.get("/api/staff-performance", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const start = String(request.query?.start || "").trim();
  const end = String(request.query?.end || "").trim();
  const staff = String(request.query?.staff || "all").trim();
  const page = Math.max(Number(request.query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(request.query?.limit) || 25, 1), 100);
  const validDate = /^\d{4}-\d{2}-\d{2}$/;
  if (!validDate.test(start) || !validDate.test(end) || start > end) return reply.code(400).send({ error: "Valid start and end dates are required." });
  const from = `${start} 00:00:00`;
  const to = `${end} 23:59:59`;

  const staffRows = db.prepare("SELECT id, name, username, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt FROM cashier_accounts ORDER BY name COLLATE NOCASE").all();
  const definitions = [
    { id: "owner", name: "Owner", username: "", role: "Owner", isActive: true, where: "t.cashier_name = 'Owner'" },
    ...staffRows.map(x => ({ id: `cashier:${x.id}`, name: x.name, username: x.username, role: "Cashier", isActive: Boolean(x.isActive), where: "t.cashier_id = ?", param: Number(x.id) })),
  ];
  const legacyCount = db.prepare("SELECT COUNT(*) AS count FROM transactions t WHERE datetime(t.created_at) BETWEEN datetime(?) AND datetime(?) AND (t.cashier_id IS NULL AND COALESCE(t.cashier_name,'') != 'Owner')").get(from,to).count;
  if (Number(legacyCount) > 0) definitions.push({ id:"legacy", name:"Unassigned / Legacy", username:"", role:"Unassigned", isActive:true, where:"t.cashier_id IS NULL AND COALESCE(t.cashier_name,'') != 'Owner'" });

  const metricFor = d => {
    const params = d.param === undefined ? [from,to] : [d.param,from,to];
    const where = d.param === undefined ? d.where : d.where;
    const row = db.prepare(`SELECT COUNT(*) AS transactions,
      COALESCE(SUM(t.total - COALESCE(t.refunded_amount,0)),0) AS netSales,
      COALESCE(SUM(t.subtotal),0) AS grossSales,
      COALESCE(SUM(t.discount),0) AS discounts,
      COALESCE(SUM(t.refunded_amount),0) AS refunds
      FROM transactions t WHERE ${where} AND datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)`).get(...params);
    const cogsParams = d.param === undefined ? [from,to] : [d.param,from,to];
    const cogs = db.prepare(`SELECT COALESCE(SUM(ti.cost_price * (ti.quantity - COALESCE(ti.refunded_quantity,0))),0) AS cogs
      FROM transaction_items ti JOIN transactions t ON t.id=ti.transaction_id
      WHERE ${d.param === undefined ? d.where : d.where} AND datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)`).get(...cogsParams).cogs;
    const netSales = Number(row.netSales), cogsNum = Number(cogs), transactions = Number(row.transactions);
    return { transactions, grossSales:Number(row.grossSales), discounts:Number(row.discounts), refunds:Number(row.refunds), netSales, cogs:cogsNum, grossProfit:netSales-cogsNum, averageSale:transactions ? netSales/transactions : 0 };
  };

  const summaries = definitions.map(d => ({ ...d, metrics: metricFor(d) }));
  const selected = definitions.find(d => d.id === staff) || null;
  let transactions = [];
  let total = 0;
  if (selected) {
    const params = selected.param === undefined ? [from,to] : [selected.param,from,to];
    const where = selected.where;
    total = Number(db.prepare(`SELECT COUNT(*) AS count FROM transactions t WHERE ${where} AND datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)`).get(...params).count);
    const offset = (page - 1) * limit;
    transactions = db.prepare(`SELECT t.id, t.transaction_number AS transactionNumber, t.subtotal, t.discount, t.total,
      t.cash_received AS cashReceived, t.change_amount AS changeAmount, t.cashier_name AS cashierName,
      t.refund_status AS refundStatus, COALESCE(t.refunded_amount,0) AS refundedAmount,
      (t.total - COALESCE(t.refunded_amount,0)) AS netSales, t.created_at AS createdAt
      FROM transactions t WHERE ${where} AND datetime(t.created_at) BETWEEN datetime(?) AND datetime(?)
      ORDER BY t.id DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
  }
  return { start, end, staff: summaries.map(({where,param,...x})=>x), selectedStaff: selected ? { id:selected.id, name:selected.name, role:selected.role } : null,
    selectedMetrics: selected ? metricFor(selected) : null,
    transactions: transactions.map(x=>({...x,subtotal:Number(x.subtotal),discount:Number(x.discount),total:Number(x.total),cashReceived:Number(x.cashReceived),changeAmount:Number(x.changeAmount),refundedAmount:Number(x.refundedAmount),netSales:Number(x.netSales)})),
    total, page, limit, totalPages: Math.max(1, Math.ceil(total/limit)) };
});

function debtStatus(total, paid) {
  const t = Number(total) || 0, p = Number(paid) || 0;
  if (p >= t - 0.005) return "paid";
  if (p > 0) return "partial";
  return "unpaid";
}

function debtSummaryRow(row) {
  const total = Number(row.totalAmount) || 0;
  const paid = Number(row.paidAmount) || 0;
  return { ...row, totalAmount: total, paidAmount: paid, balance: Math.max(0, total - paid), status: debtStatus(total, paid) };
}

app.get("/api/debts", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const status = String(request.query?.status || "all").toLowerCase();
  const supplier = String(request.query?.supplier || "").trim();
  const q = String(request.query?.q || "").trim();
  const page = Math.max(Number(request.query?.page) || 1, 1);
  const limit = Math.min(Math.max(Number(request.query?.limit) || 25, 1), 100);
  const rows = db.prepare(`
    SELECT d.id, d.supplier_name AS supplierName, d.debt_date AS debtDate, d.notes,
           d.total_amount AS totalAmount, d.created_at AS createdAt, d.updated_at AS updatedAt,
           COALESCE((SELECT SUM(p.amount) FROM supplier_debt_payments p WHERE p.debt_id=d.id),0) AS paidAmount
    FROM supplier_debts d
    WHERE (?='' OR d.supplier_name LIKE '%' || ? || '%')
      AND (?='' OR d.supplier_name LIKE '%' || ? || '%' OR d.notes LIKE '%' || ? || '%' OR EXISTS (SELECT 1 FROM supplier_debt_items di WHERE di.debt_id=d.id AND di.description LIKE '%' || ? || '%'))
    ORDER BY d.debt_date DESC, d.id DESC
  `).all(supplier, supplier, q, q, q, q).map(debtSummaryRow);
  const filtered = rows.filter(r => status === "all" || r.status === status);
  const total = filtered.length;
  const items = filtered.slice((page-1)*limit, page*limit);
  const totals = rows.reduce((a,r) => { a.total += r.totalAmount; a.paid += r.paidAmount; a.balance += r.balance; return a; }, {total:0,paid:0,balance:0});
  const suppliers = db.prepare("SELECT DISTINCT supplier_name AS name FROM supplier_debts ORDER BY supplier_name COLLATE NOCASE").all();
  return { items, total, page, limit, totalPages: Math.max(1, Math.ceil(total/limit)), totals, suppliers };
});

app.get("/api/debts/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id < 1) return reply.code(400).send({ error: "Invalid debt." });
  const row = db.prepare(`SELECT d.id, d.supplier_name AS supplierName, d.debt_date AS debtDate, d.notes, d.total_amount AS totalAmount, d.created_at AS createdAt, d.updated_at AS updatedAt, COALESCE((SELECT SUM(p.amount) FROM supplier_debt_payments p WHERE p.debt_id=d.id),0) AS paidAmount FROM supplier_debts d WHERE d.id=?`).get(id);
  if (!row) return reply.code(404).send({ error: "Debt record not found." });
  const items = db.prepare("SELECT id, description, cost, quantity FROM supplier_debt_items WHERE debt_id=? ORDER BY id").all(id).map(x => ({...x, cost:Number(x.cost), quantity:String(x.quantity ?? "1")}));
  const payments = db.prepare("SELECT id, payment_date AS paymentDate, amount, notes, created_at AS createdAt FROM supplier_debt_payments WHERE debt_id=? ORDER BY payment_date ASC, id ASC").all(id).map(x => ({...x, amount:Number(x.amount)}));
  return { ...debtSummaryRow(row), items, payments };
});

app.post("/api/debts", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const b=request.body||{}; const supplier=String(b.supplierName||"").trim(); const date=String(b.debtDate||"").trim(); const notes=String(b.notes||"").trim();
  const items=Array.isArray(b.items)?b.items:[];
  if (!supplier || supplier.length>120) return reply.code(400).send({error:"Supplier name is required and must be 120 characters or fewer."});
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({error:"A valid debt date is required."});
  if (notes.length>500) return reply.code(400).send({error:"Notes must be 500 characters or fewer."});
  const clean=items.map(x=>({rawQuantity:String(x.quantity??"").trim(),rawDescription:String(x.description??"").trim(),rawCost:String(x.cost??"").trim()})).filter(x=>x.rawQuantity!==""||x.rawDescription!==""||x.rawCost!=="").map(x=>({quantity:x.rawQuantity,description:x.rawDescription,cost:Number(x.rawCost)}));
  if (!clean.length) return reply.code(400).send({error:"Add at least one supply line."});
  if (clean.some(x=>!x.quantity || x.quantity.length>80 || !x.description || !Number.isFinite(x.cost) || x.cost<0)) return reply.code(400).send({error:"Every supply must have a quantity, a description and a valid non-negative cost."});
  const total=clean.reduce((s,x)=>s+x.cost,0);
  if (!(total>0)) return reply.code(400).send({error:"The debt total must be greater than zero."});
  const tx=db.transaction(()=>{ const r=db.prepare("INSERT INTO supplier_debts (supplier_name,debt_date,notes,total_amount) VALUES (?,?,?,?)").run(supplier,date,notes,total); const id=Number(r.lastInsertRowid); const ins=db.prepare("INSERT INTO supplier_debt_items (debt_id,description,cost,quantity) VALUES (?,?,?,?)"); clean.forEach(x=>ins.run(id,x.description,x.cost,x.quantity)); return id; });
  const id=tx(); writeAudit(request,'Supplier debt created',`${supplier}: recorded supplier debt of ${total.toFixed(2)}.`,{}, {type:'owner',id:null,name:'Owner'});
  return reply.code(201).send({id,supplierName:supplier,debtDate:date,notes,totalAmount:total,paidAmount:0,balance:total,status:'unpaid',items:clean.map((x,i)=>({id:i+1,...x})),payments:[]});
});

app.put("/api/debts/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id=Number(request.params.id); if(!Number.isInteger(id)||id<1)return reply.code(400).send({error:"Invalid debt."});
  const existing=db.prepare("SELECT id FROM supplier_debts WHERE id=?").get(id); if(!existing)return reply.code(404).send({error:"Debt record not found."});
  const b=request.body||{}; const supplier=String(b.supplierName||"").trim(); const date=String(b.debtDate||"").trim(); const notes=String(b.notes||"").trim(); const items=Array.isArray(b.items)?b.items:[];
  if(!supplier||supplier.length>120)return reply.code(400).send({error:"Supplier name is required and must be 120 characters or fewer."});
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return reply.code(400).send({error:"A valid debt date is required."});
  if(notes.length>500)return reply.code(400).send({error:"Notes must be 500 characters or fewer."});
  const clean=items.map(x=>({rawQuantity:String(x.quantity??"").trim(),rawDescription:String(x.description??"").trim(),rawCost:String(x.cost??"").trim()})).filter(x=>x.rawQuantity!==""||x.rawDescription!==""||x.rawCost!=="").map(x=>({quantity:x.rawQuantity,description:x.rawDescription,cost:Number(x.rawCost)}));
  if(!clean.length||clean.some(x=>!x.quantity || x.quantity.length>80 || !x.description || !Number.isFinite(x.cost) || x.cost<0))return reply.code(400).send({error:"Every debt must have at least one valid supply line with quantity, description and cost."});
  const total=clean.reduce((s,x)=>s+x.cost,0); if(!(total>0))return reply.code(400).send({error:"The debt total must be greater than zero."});
  const paid=Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS paid FROM supplier_debt_payments WHERE debt_id=?").get(id).paid); if(total+0.005<paid)return reply.code(400).send({error:`The new debt total cannot be less than payments already recorded (${paid.toFixed(2)}).`});
  const tx=db.transaction(()=>{db.prepare("UPDATE supplier_debts SET supplier_name=?,debt_date=?,notes=?,total_amount=?,updated_at=datetime('now','localtime') WHERE id=?").run(supplier,date,notes,total,id);db.prepare("DELETE FROM supplier_debt_items WHERE debt_id=?").run(id);const ins=db.prepare("INSERT INTO supplier_debt_items (debt_id,description,cost,quantity) VALUES (?,?,?,?)");clean.forEach(x=>ins.run(id,x.description,x.cost,x.quantity));}); tx();
  writeAudit(request,'Supplier debt updated',`${supplier}: updated supplier debt #${id}.`);
  const row=db.prepare(`SELECT d.id,d.supplier_name AS supplierName,d.debt_date AS debtDate,d.notes,d.total_amount AS totalAmount,d.created_at AS createdAt,d.updated_at AS updatedAt,COALESCE((SELECT SUM(p.amount) FROM supplier_debt_payments p WHERE p.debt_id=d.id),0) AS paidAmount FROM supplier_debts d WHERE d.id=?`).get(id); const fullItems=db.prepare("SELECT id,description,cost,quantity FROM supplier_debt_items WHERE debt_id=? ORDER BY id").all(id).map(x=>({...x,cost:Number(x.cost),quantity:String(x.quantity ?? "1")})); const fullPayments=db.prepare("SELECT id,payment_date AS paymentDate,amount,notes,created_at AS createdAt FROM supplier_debt_payments WHERE debt_id=? ORDER BY payment_date ASC,id ASC").all(id).map(x=>({...x,amount:Number(x.amount)})); return {...debtSummaryRow(row),items:fullItems,payments:fullPayments};
});

app.delete("/api/debts/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id=Number(request.params.id); if(!Number.isInteger(id)||id<1)return reply.code(400).send({error:"Invalid debt."});
  const row=db.prepare("SELECT supplier_name AS supplierName,total_amount AS totalAmount FROM supplier_debts WHERE id=?").get(id); if(!row)return reply.code(404).send({error:"Debt record not found."});
  const paymentCount=Number(db.prepare("SELECT COUNT(*) AS count FROM supplier_debt_payments WHERE debt_id=?").get(id).count); if(paymentCount>0)return reply.code(409).send({error:"This debt has payment history. Remove or correct the payments before deleting the debt."});
  db.prepare("DELETE FROM supplier_debts WHERE id=?").run(id); writeAudit(request,'Supplier debt deleted',`${row.supplierName}: deleted supplier debt #${id}.`); return {ok:true};
});

app.post("/api/debts/:id/payments", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const id=Number(request.params.id); if(!Number.isInteger(id)||id<1)return reply.code(400).send({error:"Invalid debt."});
  const debt=db.prepare("SELECT supplier_name AS supplierName,total_amount AS totalAmount FROM supplier_debts WHERE id=?").get(id); if(!debt)return reply.code(404).send({error:"Debt record not found."});
  const b=request.body||{}; const date=String(b.paymentDate||"").trim(); const amount=Number(b.amount); const notes=String(b.notes||"").trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(amount)||amount<=0)return reply.code(400).send({error:"Payment date and a valid payment amount are required."});
  if(notes.length>300)return reply.code(400).send({error:"Payment notes must be 300 characters or fewer."});
  const paid=Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS paid FROM supplier_debt_payments WHERE debt_id=?").get(id).paid); const balance=Number(debt.totalAmount)-paid;
  if(amount>balance+0.005)return reply.code(400).send({error:`Payment cannot exceed the remaining balance of ${balance.toFixed(2)}.`});
  const r=db.prepare("INSERT INTO supplier_debt_payments (debt_id,payment_date,amount,notes) VALUES (?,?,?,?)").run(id,date,amount,notes); db.prepare("UPDATE supplier_debts SET updated_at=datetime('now','localtime') WHERE id=?").run(id); writeAudit(request,'Supplier debt payment recorded',`${debt.supplierName}: recorded supplier payment of ${amount.toFixed(2)} on ${date}.`); return reply.code(201).send({id:Number(r.lastInsertRowid),debtId:id,paymentDate:date,amount,notes});
});

app.delete("/api/debts/:debtId/payments/:paymentId", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const debtId=Number(request.params.debtId), paymentId=Number(request.params.paymentId); if(!Number.isInteger(debtId)||!Number.isInteger(paymentId))return reply.code(400).send({error:"Invalid payment."});
  const row=db.prepare("SELECT p.id,p.amount,d.supplier_name AS supplierName FROM supplier_debt_payments p JOIN supplier_debts d ON d.id=p.debt_id WHERE p.id=? AND p.debt_id=?").get(paymentId,debtId); if(!row)return reply.code(404).send({error:"Payment not found."});
  db.prepare("DELETE FROM supplier_debt_payments WHERE id=?").run(paymentId); db.prepare("UPDATE supplier_debts SET updated_at=datetime('now','localtime') WHERE id=?").run(debtId); writeAudit(request,'Supplier debt payment deleted',`${row.supplierName}: deleted supplier payment of ${Number(row.amount).toFixed(2)}.`); return {ok:true};
});

app.post("/api/expenses", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const b = request.body || {};
  const date = String(b.date || "").trim();
  const category = String(b.category || "").trim();
  const description = String(b.description || "").trim();
  const amount = Number(b.amount);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !category || !description || !Number.isFinite(amount) || amount <= 0) return reply.code(400).send({ error: "Date, category, description and a valid amount are required." });
  const result = db.prepare("INSERT INTO expenses (expense_date, category, description, amount) VALUES (?,?,?,?)").run(date, category, description, amount);
  return reply.code(201).send({ id:Number(result.lastInsertRowid), date, category, description, amount });
});

app.delete("/api/expenses/:id", async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const result = db.prepare("DELETE FROM expenses WHERE id=?").run(Number(request.params.id));
  if (!result.changes) return reply.code(404).send({ error: "Expense not found." });
  return { ok:true };
});

app.addHook("onClose", async () => db.close());

app.listen({ port: 3001, host: "0.0.0.0" })
  .then(() => console.log("POS API + SQLite running on http://localhost:3001"))
  .catch(err => { console.error(err); process.exit(1); });

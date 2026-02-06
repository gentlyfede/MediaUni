import "dotenv/config";

import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();

/**
 * CORS
 */
const ORIGINS = (process.env.ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: ORIGINS.length ? ORIGINS : true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "2mb" }));

// Logger
app.use((req, _res, next) => {
  console.log(new Date().toISOString(), req.method, req.url);
  next();
});

const PORT = Number(process.env.PORT || 8787);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL in .env");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in .env");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
console.log("Supabase client created");

const CODE_RE = /^\d{2}-\d{2}$/;

function isValidRow(r) {
  return (
    r &&
    typeof r === "object" &&
    typeof r.codice === "string" &&
    typeof r.denominazione === "string" &&
    Number.isInteger(r.cfu)
  );
}

app.get("/", (_req, res) => res.send("UniMedia API OK"));

app.get("/api/plans/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim();
    if (!CODE_RE.test(code)) return res.status(400).json({ error: "Bad code" });

    const { data, error } = await supabase
      .from("plans")
      .select("code,rows,updated_at")
      .eq("code", code)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.post("/api/plans", async (req, res) => {
  try {
    const { code, rows } = req.body ?? {};

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "No code" });
    }
    const codeTrim = code.trim();
    if (!CODE_RE.test(codeTrim)) {
      return res.status(400).json({ error: "Bad code" });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No rows" });
    }

    if (!rows.every(isValidRow)) {
      return res.status(400).json({
        error: "Bad rows format (expected {codice, denominazione, cfu:int})",
      });
    }

    const cleaned = rows
      .map((r) => ({
        codice: String(r.codice).trim(),
        denominazione: String(r.denominazione).trim(),
        cfu: Number(r.cfu),
      }))
      .filter((r) => r.codice && r.denominazione && Number.isInteger(r.cfu) && r.cfu >= 1 && r.cfu <= 30)
      .slice(0, 200);

    if (cleaned.length === 0) {
      return res.status(400).json({ error: "No valid rows after cleaning" });
    }

    // 1) Se esiste già, blocca (non sovrascrivere)
    const { data: existing, error: existingErr } = await supabase
      .from("plans")
      .select("code")
      .eq("code", codeTrim)
      .maybeSingle();

    if (existingErr) return res.status(500).json({ error: existingErr.message });

    if (existing) {
      // 409 Conflict = richiesta in conflitto con lo stato corrente della risorsa. [web:2634]
      return res.status(409).json({ ok: false, error: "Plan already exists", code: codeTrim });
    }

    // 2) Inserisci SOLO se non esiste (no upsert)
    const payload = {
      code: codeTrim,
      rows: cleaned,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase.from("plans").insert(payload).select("code,rows,updated_at").single();

    if (error) {
      // Se per race condition qualcuno lo ha creato tra check e insert, torna comunque 409
      if (String(error.message || "").toLowerCase().includes("duplicate")) {
        return res.status(409).json({ ok: false, error: "Plan already exists", code: codeTrim });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

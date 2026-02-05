import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";

type Exam = {
  id: string;
  name: string;
  cfu: number;
  grade: string; // vuoto = non dato
};

type PlanRow = {
  codice: string;
  denominazione: string;
  cfu: number;
};

type PlanDoc = {
  code: string;
  rows: PlanRow[];
  updated_at: string | null;
};

function makeId() {
  return String(Date.now()) + "-" + String(Math.random()).slice(2);
}

function parseGrade(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 30) return null;
  return n;
}

function parseCfu(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function weightedAverage(exams: Exam[]): number | null {
  let sum = 0;
  let total = 0;
  for (const e of exams) {
    const g = parseGrade(e.grade);
    if (g === null) continue;
    if (e.cfu <= 0) continue;
    sum += g * e.cfu;
    total += e.cfu;
  }
  if (total === 0) return null;
  return sum / total;
}

function parseCsvAuto(text: string): { headers: string[]; rows: Record<string, string>[]; sep: string } {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return { headers: [], rows: [], sep: ";" };

  const headerLine = lines[0];
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const sep = semicolons >= commas ? ";" : ",";

  const headers = headerLine
    .split(sep)
    .map((s) => s.trim().replace(/^\uFEFF/, "").replace(/^"|"$/g, ""));

  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(sep);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = (cols[i] ?? "").trim().replace(/^"|"$/g, "");
    });
    rows.push(obj);
  }

  return { headers, rows, sep };
}

function normalizeHeaderName(s: string): string {
  return s.replace(/^\uFEFF/, "").replace(/\x00/g, "").trim();
}

function requireExactHeaders(headers: string[], expected: string[]) {
  const got = headers.map(normalizeHeaderName);
  const exp = expected.map(normalizeHeaderName);

  const sameLength = got.length === exp.length;
  const sameOrder = sameLength && got.every((h, i) => h === exp[i]);

  if (!sameOrder) {
    throw new Error("Header CSV non valido.\n" + `Atteso: ${exp.join(";")}\n` + `Trovato: ${got.join(";")}`);
  }
}

function format2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseCoursePart(s: string): number | null {
  const t = s.trim();
  if (!/^\d{2}$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > 99) return null;
  return n;
}

function parseCourseFromFilename(name: string): { xx: string; yy: string } | null {
  const m = name.trim().match(/^(\d{2})-(\d{2})\.csv$/i);
  if (!m) return null;
  return { xx: m[1], yy: m[2] };
}

function demoExams(): Exam[] {
  return [
    { id: makeId(), name: "Analisi 1", cfu: 10, grade: "28" },
    { id: makeId(), name: "Fisica 1", cfu: 10, grade: "24" },
    { id: makeId(), name: "Informatica", cfu: 5, grade: "" },
  ];
}

async function readFileTextUtf8OrUtf16(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  const isUtf16LeBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const isUtf16BeBom = bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff;
  const isUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;

  if (isUtf16LeBom) return new TextDecoder("utf-16le").decode(buf);
  if (isUtf16BeBom) return new TextDecoder("utf-16be").decode(buf);
  if (isUtf8Bom) return new TextDecoder("utf-8").decode(buf);

  let zeroOdd = 0;
  const sampleLen = Math.min(bytes.length, 4000);
  for (let i = 1; i < sampleLen; i += 2) if (bytes[i] === 0) zeroOdd++;
  const ratio = zeroOdd / Math.max(1, sampleLen / 2);

  const enc = ratio > 0.2 ? "utf-16le" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}

const API_BASE =
  import.meta.env.VITE_API_BASE ??
  (typeof window !== "undefined" && window.location.hostname === "localhost" ? "http://127.0.0.1:8787" : "");

async function apiGetPlan(code: string) {
  return fetch(`${API_BASE}/api/plans/${encodeURIComponent(code)}`);
}

async function apiSavePlan(code: string, rows: PlanRow[]) {
  const res = await fetch(`${API_BASE}/api/plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, rows }),
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function normKey(name: string, cfu: number) {
  return `${String(name).trim().toLowerCase().replace(/\s+/g, " ")}|${cfu}`;
}

/**
 * Apple-ish theme:
 * - Usa le CSS vars definite in src/index.css (quelle che ti ho dato prima).
 * - Inline styles qui sotto richiamano var(--...) per non risultare “cheap”.
 */
const styles = {
  page: {
    minHeight: "100vh",
    background: "transparent",
    color: "var(--text)",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  } as const,

  shell: {
    maxWidth: 980,
    margin: "0 auto",
    padding: "28px 16px 56px",
  } as const,

  topbar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  } as const,

  title: {
    margin: 0,
    fontSize: "clamp(34px, 5vw, 56px)",
    fontWeight: 780,
    letterSpacing: "-0.9px",
    color: "var(--text)",
  } as const,

  subtitle: {
    margin: "10px auto 0",
    maxWidth: 640,
    textAlign: "center" as const,
    color: "var(--muted)",
    fontSize: 14,
    lineHeight: 1.45,
  } as const,

  panel: {
    marginTop: 18,
    borderRadius: "var(--r-lg)",
    border: "1px solid var(--hairline)",
    background: "var(--bg-elev)",
    boxShadow: "var(--shadow-md)",
    padding: 16,
    backdropFilter: "blur(18px) saturate(160%)",
    WebkitBackdropFilter: "blur(18px) saturate(160%)",
  } as const,

  actions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap" as const,
    justifyContent: "center",
    marginBottom: 10,
  } as const,

  btn: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.92)",
    color: "var(--text)",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  } as const,

  btnFilled: {
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "var(--text)",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
  } as const,

  link: {
    margin: "8px auto 0",
    maxWidth: 720,
    textAlign: "center" as const,
    fontSize: 13,
    color: "rgba(29,29,31,0.72)",
    textDecoration: "underline",
    cursor: "pointer",
    userSelect: "none" as const,
  } as const,

  status: {
    margin: "10px auto 0",
    maxWidth: 820,
    whiteSpace: "pre-wrap" as const,
    textAlign: "center" as const,
    fontSize: 13,
    color: "rgba(29,29,31,0.72)",
  } as const,

  cards: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 14,
  } as const,

  card: {
    borderRadius: "var(--r-md)",
    border: "1px solid var(--hairline)",
    background: "rgba(255,255,255,0.92)",
    padding: 14,
    boxShadow: "var(--shadow-sm)",
    textAlign: "center" as const,
    backdropFilter: "blur(14px) saturate(160%)",
    WebkitBackdropFilter: "blur(14px) saturate(160%)",
  } as const,

  label: {
    fontSize: 12,
    color: "rgba(29,29,31,0.62)",
  } as const,

  value: {
    marginTop: 6,
    fontSize: 34,
    fontWeight: 760,
    letterSpacing: -0.6,
    color: "var(--text)",
  } as const,

  sectionTitle: {
    margin: "18px 0 10px",
    textAlign: "center" as const,
    fontSize: 14,
    fontWeight: 650,
    color: "rgba(29,29,31,0.72)",
  } as const,

  tableWrap: {
    overflowX: "auto" as const,
    borderRadius: "var(--r-md)",
    border: "1px solid var(--hairline)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "var(--shadow-sm)",
  } as const,

  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    minWidth: 720,
  } as const,

  th: {
    fontSize: 12,
    color: "rgba(29,29,31,0.55)",
    textAlign: "left" as const,
    padding: 12,
    borderBottom: "1px solid rgba(0,0,0,0.06)",
    background: "rgba(0,0,0,0.02)",
  } as const,

  td: {
    padding: 12,
    borderBottom: "1px solid rgba(0,0,0,0.05)",
    verticalAlign: "top" as const,
  } as const,

  input: {
    width: "100%",
    padding: "10px 10px",
    borderRadius: "var(--r-sm)",
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.96)",
    color: "var(--text)",
    outline: "none",
    fontSize: 14,
  } as const,

  inputBad: {
    width: "100%",
    padding: "10px 10px",
    borderRadius: "var(--r-sm)",
    border: "1px solid rgba(239,68,68,0.55)",
    background: "#fff1f2",
    color: "var(--text)",
    outline: "none",
    fontSize: 14,
  } as const,

  smallError: {
    marginTop: 6,
    fontSize: 12,
    color: "rgba(220,38,38,0.9)",
  } as const,

  whatif: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap" as const,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  } as const,

  select: {
    padding: "10px 10px",
    borderRadius: "var(--r-sm)",
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.96)",
    color: "var(--text)",
    outline: "none",
    maxWidth: 520,
    fontSize: 14,
  } as const,

  hint: {
    fontSize: 12,
    color: "rgba(29,29,31,0.55)",
    textAlign: "center" as const,
    marginTop: 10,
  } as const,

  sheet: {
    margin: "12px auto 0",
    maxWidth: 880,
    borderRadius: "var(--r-lg)",
    border: "1px solid var(--hairline)",
    background: "rgba(255,255,255,0.92)",
    boxShadow: "var(--shadow-md)",
    padding: 14,
    backdropFilter: "blur(16px) saturate(160%)",
    WebkitBackdropFilter: "blur(16px) saturate(160%)",
  } as const,

  sheetTitle: {
    fontSize: 13,
    color: "rgba(29,29,31,0.78)",
    textAlign: "center" as const,
    marginBottom: 10,
    lineHeight: 1.45,
  } as const,

  codeRow: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 10,
    flexWrap: "wrap" as const,
  } as const,

  codeBox: {
    width: 64,
    textAlign: "center" as const,
    padding: "10px 10px",
    borderRadius: "var(--r-sm)",
    border: "1px solid rgba(0,0,0,0.12)",
    background: "rgba(255,255,255,0.96)",
    color: "var(--text)",
    outline: "none",
    fontSize: 16,
    letterSpacing: 1.2,
  } as const,

  slash: {
    fontSize: 16,
    color: "rgba(29,29,31,0.55)",
  } as const,

  promptTop: {
    marginTop: 10,
    textAlign: "center" as const,
    fontSize: 13,
    color: "rgba(29,29,31,0.78)",
    lineHeight: 1.45,
  } as const,

  promptBox: {
    marginTop: 10,
    padding: 12,
    borderRadius: "var(--r-md)",
    border: "1px solid rgba(0,0,0,0.08)",
    background: "rgba(0,0,0,0.02)",
    color: "rgba(29,29,31,0.84)",
    fontSize: 13,
    lineHeight: 1.45,
    whiteSpace: "pre-wrap" as const,
  } as const,

  promptBottom: {
    marginTop: 10,
    textAlign: "center" as const,
    fontSize: 13,
    color: "rgba(29,29,31,0.72)",
    lineHeight: 1.45,
  } as const,

  divider: {
    height: 1,
    background: "rgba(0,0,0,0.08)",
    margin: "12px 0",
  } as const,

  modalBackdrop: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.22)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 50,
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  } as const,

  modalCard: {
    width: "min(980px, 100%)",
    maxHeight: "min(82vh, 900px)",
    overflow: "auto" as const,
    borderRadius: "var(--r-lg)",
    border: "1px solid rgba(255,255,255,0.25)",
    background: "rgba(255,255,255,0.88)",
    boxShadow: "0 22px 80px rgba(0,0,0,0.22)",
    padding: 14,
    backdropFilter: "blur(18px) saturate(160%)",
    WebkitBackdropFilter: "blur(18px) saturate(160%)",
  } as const,
};

export default function App() {
  const STORAGE_KEY = "unimedia.exams.v5";

  const [exams, setExams] = useState<Exam[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return demoExams();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return demoExams();
      return parsed
        .map((e: any) => ({
          id: typeof e?.id === "string" ? e.id : makeId(),
          name: String(e?.name ?? ""),
          cfu: parseCfu(Number(e?.cfu ?? 0)),
          grade: String(e?.grade ?? ""),
        }))
        .filter((e: Exam) => e.name.length > 0 || e.cfu > 0 || e.grade.trim() !== "");
    } catch {
      return demoExams();
    }
  });

  const [whatIfExamId, setWhatIfExamId] = useState<string>(exams[0]?.id ?? "");
  const [whatIfGrade, setWhatIfGrade] = useState<string>("28");
  const [status, setStatus] = useState<string>("");

  // NEW: status auto-clear timer (solo per success “pulito”)
  const statusTimerRef = useRef<number | null>(null);
  function flashStatus(msg: string, ms = 1600) {
    setStatus(msg);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      setStatus("");
      statusTimerRef.current = null;
    }, ms);
  }
  useEffect(() => {
    return () => {
      if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    };
  }, []);

  const [helpOpen, setHelpOpen] = useState<boolean>(false);
  const [courseXX, setCourseXX] = useState<string>("");
  const [courseYY, setCourseYY] = useState<string>("");

  // Lookup modal
  const [lookupOpen, setLookupOpen] = useState<boolean>(false);
  const [lookupXX, setLookupXX] = useState<string>("");
  const [lookupYY, setLookupYY] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [lookupMessage, setLookupMessage] = useState<string>("");
  const [foundPlan, setFoundPlan] = useState<PlanDoc | null>(null);

  // Selezione per indice (evita effetto cascata se codici ripetuti)
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());

  const xxNum = useMemo(() => parseCoursePart(courseXX), [courseXX]);
  const yyNum = useMemo(() => parseCoursePart(courseYY), [courseYY]);
  const courseOk = xxNum !== null && yyNum !== null;

  const lookupXxNum = useMemo(() => parseCoursePart(lookupXX), [lookupXX]);
  const lookupYyNum = useMemo(() => parseCoursePart(lookupYY), [lookupYY]);
  const lookupOk = lookupXxNum !== null && lookupYyNum !== null;
  const lookupCode = lookupOk ? `${format2(lookupXxNum!)}-${format2(lookupYyNum!)}` : "";

  const currentAvg = useMemo(() => weightedAverage(exams), [exams]);

  const whatIfAvg = useMemo(() => {
    const g = parseGrade(whatIfGrade);
    if (g === null) return currentAvg;
    const simulated = exams.map((e) => (e.id === whatIfExamId ? { ...e, grade: String(g) } : e));
    return weightedAverage(simulated);
  }, [exams, whatIfExamId, whatIfGrade, currentAvg]);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(exams));
    } catch {
      // ignore
    }
  }, [exams]);

  // What-if: se l'id selezionato non esiste più, riallinea
  useEffect(() => {
    const ids = new Set(exams.map((e) => e.id));
    if (whatIfExamId && ids.has(whatIfExamId)) return;
    setWhatIfExamId(exams[0]?.id ?? "");
  }, [exams, whatIfExamId]);

  // Lock scroll quando modal aperto
  useEffect(() => {
    if (!lookupOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lookupOpen]);

  function addExam() {
    const id = makeId();
    setExams((prev) => [...prev, { id, name: "Nuovo esame", cfu: 6, grade: "" }]);
    if (!whatIfExamId) setWhatIfExamId(id);
  }

  function removeExam(id: string) {
    setExams((prev) => prev.filter((e) => e.id !== id));
  }

  function updateExam(id: string, patch: Partial<Exam>) {
    setExams((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function buildUserPrompt(xx: number, yy: number) {
    const XX = format2(xx);
    const YY = format2(yy);
    const fname = `${XX}-${YY}.csv`;

    return (
      `Genera un file CSV (separatore ;) in UTF-8 chiamato ESATTAMENTE ${fname} (due numeri, trattino, due numeri, estensione .csv).\n` +
      `La prima riga (header) deve essere ESATTAMENTE:\n` +
      `Codice;Denominazione;CFU\n` +
      `Poi crea una riga per ogni insegnamento con questi vincoli:\n` +
      `Codice: stringa del codice corso (può contenere /, -, spazi e anche “o” come in 70/0041-M o IN/0155).\n` +
      `Denominazione: nome dell’insegnamento (testo).\n` +
      `CFU: intero positivo (es. 6, 7, 8, 9, 10, 12).\n` +
      `Non aggiungere altre colonne. Non mettere virgolette inutili. Non usare la virgola come separatore: usa SEMPRE ;.\n` +
      `Imperativo che mi restituisci un file .csv (allegato/scaricabile) e non semplice testo.`
    );
  }

  async function onPickPlanFile(file: File) {
    const parsed = parseCourseFromFilename(file.name);
    if (!parsed) throw new Error('Nome file non valido. Deve essere tipo "70-89.csv".');

    const code = `${parsed.xx}-${parsed.yy}`;

    setCourseXX(parsed.xx);
    setCourseYY(parsed.yy);

    const text = await readFileTextUtf8OrUtf16(file);
    const { headers, rows } = parseCsvAuto(text);

    const EXPECTED_HEADERS = ["Codice", "Denominazione", "CFU"];
    requireExactHeaders(headers, EXPECTED_HEADERS);

    const planRows: PlanRow[] = rows
      .map((r) => {
        const codice = String(r["Codice"] ?? "").trim().replace(/^"|"$/g, "");
        const denominazione = String(r["Denominazione"] ?? "").trim().replace(/^"|"$/g, "");
        const cfuRaw = String(r["CFU"] ?? "").trim().replace(",", ".");
        const cfu = parseCfu(Number(cfuRaw));
        return { codice, denominazione, cfu };
      })
      .filter((x) => x.codice.length > 0 && x.denominazione.length > 0 && x.cfu > 0);

    if (planRows.length === 0) {
      throw new Error("CSV valido ma nessuna riga utile (Codice/Denominazione/CFU vuoti?).");
    }

    const next: Exam[] = planRows.map((p) => ({
      id: makeId(),
      name: p.denominazione,
      cfu: p.cfu,
      grade: "",
    }));

    setExams(next);
    setStatus(`Verifico il piano ${code}...`);

    const checkRes = await apiGetPlan(code);

    if (checkRes.ok) {
      const yes = window.confirm(`Il piano ${code} esiste già. Vuoi sovrascrivere?`);
      if (!yes) {
        setStatus("Piano caricato in UI, ma NON salvato(annullato).");
        return;
      }
    } else if (checkRes.status !== 404) {
      const txt = await checkRes.text().catch(() => "");
      throw new Error(`Errore verifica (${checkRes.status}): ${txt}`);
    }

    setStatus(`Salvataggio (${code})...`);

    const { res: saveRes, json } = await apiSavePlan(code, planRows);
    if (!saveRes.ok || !json?.ok) {
      throw new Error(`Errore salvataggio API: ${JSON.stringify(json)}`);
    }

    // CHANGED: niente “Caricato su Supabase ...” fisso (feedback pulito e temporaneo)
    flashStatus("Piano salvato.");
  }

  async function handleCsvUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0] ?? null;
    if (!file) return;

    try {
      setStatus("Caricamento piano…");
      await onPickPlanFile(file);
    } catch (err: any) {
      setStatus(`Errore: ${err?.message ?? String(err)}`);
    } finally {
      e.currentTarget.value = "";
    }
  }

  function onResetDemo() {
    const d = demoExams();
    setExams(d);
    setStatus("Demo ripristinata.");
  }

  function onClearAll() {
    setExams([]);
    setStatus("Lista svuotata.");
  }

  function toggleHelp() {
    setHelpOpen((v) => !v);
  }

  function openLookup() {
    setLookupOpen(true);
    setLookupMessage("");
    setFoundPlan(null);
    setSelectedIdx(new Set());
  }

  function closeLookup() {
    setLookupOpen(false);
    setLookupLoading(false);
  }

  function toggleIdx(i: number) {
    setSelectedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function selectAllFound() {
    if (!foundPlan) return;
    const next = new Set<number>();
    for (let i = 0; i < foundPlan.rows.length; i++) next.add(i);
    setSelectedIdx(next);
  }

  function selectNoneFound() {
    setSelectedIdx(new Set());
  }

  async function doLookupPlan() {
    if (!lookupOk) {
      setLookupMessage("Inserisci un codice valido (due cifre + due cifre).");
      return;
    }

    try {
      setLookupLoading(true);
      setLookupMessage(`Ricerca piano ${lookupCode}…`);
      setFoundPlan(null);
      setSelectedIdx(new Set());

      const res = await apiGetPlan(lookupCode);

      if (res.status === 404) {
        setLookupMessage("Questo piano non è ancora stato caricato da nessun utente.");
        return;
      }

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        setLookupMessage(`Errore server (${res.status}): ${txt}`);
        return;
      }

      const data = (await res.json()) as PlanDoc;

      if (!data || !Array.isArray((data as any).rows)) {
        setLookupMessage("Risposta non valida dal server.");
        return;
      }

      setFoundPlan(data);
      setLookupMessage(`Piano trovato: ${data.code}. Seleziona gli esami da aggiungere.`);

      const nextSel = new Set<number>();
      for (let i = 0; i < data.rows.length; i++) nextSel.add(i);
      setSelectedIdx(nextSel);
    } catch (e: any) {
      setLookupMessage(`Errore: ${e?.message ?? String(e)}`);
    } finally {
      setLookupLoading(false);
    }
  }

  function addSelectedFromFound() {
    if (!foundPlan) return;

    const plan = foundPlan;
    const selected = plan.rows.filter((_, i) => selectedIdx.has(i));
    if (selected.length === 0) {
      setLookupMessage("Nessun esame selezionato.");
      return;
    }

    closeLookup();

    setExams((prev) => {
      const existing = new Set(prev.map((e) => normKey(e.name, e.cfu)));
      const toAdd: Exam[] = [];

      for (const r of selected) {
        const key = normKey(r.denominazione, r.cfu);
        if (existing.has(key)) continue;
        existing.add(key);
        toAdd.push({ id: makeId(), name: r.denominazione, cfu: r.cfu, grade: "" });
      }

      const merged = [...prev, ...toAdd];
      const skipped = selected.length - toAdd.length;
      setStatus(
        `Aggiunti ${toAdd.length} esami dal piano ${plan.code}` + (skipped > 0 ? ` (saltati ${skipped} duplicati).` : ".")
      );
      return merged;
    });
  }

  return (
    <div style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.topbar}>
          <h1 style={styles.title}>UniMedia</h1>
        </div>

        <div style={styles.subtitle}>
          Calcola la media pesata e simula i voti futuri. Carica un piano o recuperalo dalla memoria condivisa.
        </div>

        <div style={styles.panel}>
          <div style={styles.actions}>
            <label style={styles.btn as any}>
              Carica piano
              <input type="file" accept=".csv,text/csv" onChange={handleCsvUpload} style={{ display: "none" }} />
            </label>

            <button style={styles.btn} onClick={openLookup}>
              Cerca piano
            </button>

            <button style={styles.btn} onClick={addExam}>
              + Aggiungi esame
            </button>

            <button style={styles.btn} onClick={onResetDemo}>
              Reset demo
            </button>

            <button style={styles.btn} onClick={onClearAll}>
              Svuota
            </button>
          </div>

          <div style={styles.link} onClick={toggleHelp}>
            Come creo il piano?
          </div>

          {helpOpen && (
            <div style={styles.sheet}>
              <div style={styles.sheetTitle}>
                Qual è il codice del corso? (Es. Matr: 70/89/00000, il codice del corso è 70/89)
              </div>

              <div style={styles.codeRow}>
                <input
                  value={courseXX}
                  onChange={(e) => setCourseXX(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  placeholder="XX"
                  inputMode="numeric"
                  style={styles.codeBox}
                />
                <div style={styles.slash}>/</div>
                <input
                  value={courseYY}
                  onChange={(e) => setCourseYY(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  placeholder="YY"
                  inputMode="numeric"
                  style={styles.codeBox}
                />
              </div>

              {!courseOk && (courseXX.trim() !== "" || courseYY.trim() !== "") && (
                <div style={{ ...styles.smallError, textAlign: "center" }}>
                  Inserisci due numeri da 00 a 99 (due cifre per ciascun campo).
                </div>
              )}

              {courseOk ? (
                <>
                  <div style={styles.promptTop}>
                    Prepara screenshot con codici, insegnamenti e CFU. Caricali su un’AI e chiedi di generare il file usando
                    la domanda qui sotto.
                  </div>
                  <div style={styles.promptBox}>
                    <em>{buildUserPrompt(xxNum!, yyNum!)}</em>
                  </div>
                  <div style={styles.promptBottom}>Poi carica il file con “Carica piano”.</div>
                </>
              ) : (
                <div style={styles.promptBox}>Inserisci il codice corso per vedere il prompt.</div>
              )}
            </div>
          )}

          {status && <div style={styles.status}>{status}</div>}

          <div className="cards" style={styles.cards}>
            <div style={styles.card}>
              <div style={styles.label}>Media attuale</div>
              <div style={styles.value}>{currentAvg === null ? "—" : currentAvg.toFixed(2)}</div>
            </div>

            <div style={styles.card}>
              <div style={styles.label}>Media con simulazione</div>
              <div style={styles.value}>{whatIfAvg === null ? "—" : whatIfAvg.toFixed(2)}</div>
            </div>
          </div>

          <div style={styles.sectionTitle}>Esami</div>

          <div style={styles.tableWrap}>
            <table className="table" style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Nome</th>
                  <th style={{ ...styles.th, width: 120 }}>CFU</th>
                  <th style={{ ...styles.th, width: 220 }}>Voto (0–30)</th>
                  <th style={{ ...styles.th, width: 110 }} />
                </tr>
              </thead>

              <tbody>
                {exams.map((e) => {
                  const gradeParsed = parseGrade(e.grade);
                  const gradeOk = e.grade.trim() === "" || gradeParsed !== null;

                  return (
                    <tr key={e.id}>
                      <td style={styles.td}>
                        <input value={e.name} onChange={(ev) => updateExam(e.id, { name: ev.target.value })} style={styles.input} />
                      </td>

                      <td style={styles.td}>
                        <input
                          type="number"
                          value={e.cfu}
                          min={0}
                          onChange={(ev) => updateExam(e.id, { cfu: parseCfu(Number(ev.target.value)) })}
                          style={styles.input}
                        />
                      </td>

                      <td style={styles.td}>
                        <input
                          inputMode="numeric"
                          value={e.grade}
                          placeholder="(vuoto = non dato)"
                          onChange={(ev) => updateExam(e.id, { grade: ev.target.value })}
                          style={gradeOk ? styles.input : styles.inputBad}
                        />
                        {!gradeOk && <div style={styles.smallError}>Inserisci un numero 0–30 o lascia vuoto.</div>}
                      </td>

                      <td style={styles.td}>
                        <button style={styles.btn} onClick={() => removeExam(e.id)}>
                          Rimuovi
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={styles.sectionTitle}>Simulatore “what‑if”</div>

          <div style={styles.whatif}>
            <label>
              <span style={{ fontSize: 13, color: "rgba(29,29,31,0.75)" }}>Esame</span>
              <div style={{ height: 6 }} />
              <select style={styles.select} value={whatIfExamId} onChange={(e) => setWhatIfExamId(e.target.value)}>
                {exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.cfu} CFU)
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span style={{ fontSize: 13, color: "rgba(29,29,31,0.75)" }}>Voto ipotetico</span>
              <div style={{ height: 6 }} />
              <input
                style={{ ...styles.input, width: 140 }}
                inputMode="numeric"
                value={whatIfGrade}
                onChange={(e) => setWhatIfGrade(e.target.value)}
              />
            </label>
          </div>

          <div style={styles.hint}>Beta Webapp</div>
        </div>
      </div>

      {lookupOpen && (
        <div
          style={styles.modalBackdrop}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeLookup();
          }}
        >
          <div style={styles.modalCard}>
            {/* CHANGED: micro-hint Apple-style (senza rovinare la UI) */}
            <div style={styles.sheetTitle}>
              <div>Cerca un piano già caricato e scegli quali esami importare.</div>
              <div style={{ marginTop: 6, fontSize: 12, color: "rgba(29,29,31,0.62)" }}>
                Inserisci le prime 4 cifre della matricola: XX e YY (es. 70/89 → 70 e 89).
              </div>
            </div>

            <div style={styles.codeRow}>
              <input
                value={lookupXX}
                onChange={(e) => setLookupXX(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                placeholder="XX"
                inputMode="numeric"
                style={styles.codeBox}
                disabled={lookupLoading}
              />
              <div style={styles.slash}>-</div>
              <input
                value={lookupYY}
                onChange={(e) => setLookupYY(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                placeholder="YY"
                inputMode="numeric"
                style={styles.codeBox}
                disabled={lookupLoading}
              />

              <button style={styles.btnFilled} onClick={doLookupPlan} disabled={lookupLoading}>
                {lookupLoading ? "Cerco…" : "Cerca"}
              </button>

              <button style={styles.btn} onClick={closeLookup} disabled={lookupLoading}>
                Chiudi
              </button>
            </div>

            {!lookupOk && (lookupXX.trim() !== "" || lookupYY.trim() !== "") && (
              <div style={{ ...styles.smallError, textAlign: "center" }}>
                Inserisci due numeri da 00 a 99 (due cifre per ciascun campo).
              </div>
            )}

            {lookupMessage && <div style={{ ...styles.status, marginTop: 0 }}>{lookupMessage}</div>}

            {foundPlan && (
              <>
                <div style={styles.divider} />

                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button style={styles.btn} onClick={selectAllFound}>
                    Seleziona tutto
                  </button>
                  <button style={styles.btn} onClick={selectNoneFound}>
                    Seleziona niente
                  </button>
                  <button style={styles.btnFilled} onClick={addSelectedFromFound}>
                    Aggiungi selezionati
                  </button>
                </div>

                <div style={{ height: 10 }} />

                <div style={styles.tableWrap}>
                  <table className="table" style={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ ...styles.th, width: 110 }}>Aggiungi</th>
                        <th style={{ ...styles.th, width: 160 }}>Codice</th>
                        <th style={styles.th}>Denominazione</th>
                        <th style={{ ...styles.th, width: 90 }}>CFU</th>
                      </tr>
                    </thead>

                    <tbody>
                      {foundPlan.rows.map((r, i) => {
                        const checked = selectedIdx.has(i);
                        return (
                          <tr key={`${r.codice}-${i}`}>
                            <td style={styles.td}>
                              <input
                                className="umToggleInput"
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleIdx(i)}
                                aria-label="Seleziona esame"
                              />
                            </td>
                            <td style={styles.td}>{r.codice}</td>
                            <td style={styles.td}>{r.denominazione}</td>
                            <td style={styles.td}>{r.cfu}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

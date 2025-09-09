/*  
===========================
🚀 PASOS PARA PRODUCCIÓN 🚀
===========================

1️⃣ Guarda cambios.
2️⃣ En la carpeta raíz:
    npm run dev:prod
   (si no tienes Node)
    winget install OpenJS.NodeJS.LTS

3️⃣ Sube: index.html, styles.css, app.js, criterios.xlsx, y la carpeta /images con:
    images/gfp.png
    images/seco.png
    images/basel.png
*/

/* global Papa, XLSX */
const { useState, useMemo, useEffect } = React;

/* ==========================
   Helpers de limpieza/parsing
   ========================== */
const normStr = (s) => (s ?? "").toString().trim();
const isTruthySi = (s) => ["sí","si","true","1","x","✔"].includes(normStr(s).toLowerCase());

function parseNumberLoose(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  let s = normStr(v).replace(/\s/g, "");
  const commas = (s.match(/,/g) || []).length;
  const dots = (s.match(/\./g) || []).length;
  if (commas && !dots) s = s.replace(/\./g, "").replace(",", ".");
  else if (commas && dots && s.lastIndexOf(",") > s.lastIndexOf(".")) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseDateLoose(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return isNaN(v) ? null : v;

  // Números tipo serial de Excel
  if (typeof v === "number") {
    if (v > 25569 && v < 60000) { // heurística
      const ms = (v - 25569) * 86400 * 1000;
      return new Date(ms);
    }
  }

  const s = normStr(v);

  // ISO-like primero
  let d = new Date(s);
  if (!isNaN(d)) return d;

  // dd/mm/yyyy[ hh:mm[:ss]]  ó  dd-mm-yyyy[ hh:mm[:ss]]
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const [, dd, mm, yyyy, HH="0", MM="0", SS="0"] = m;
    const Y = Number(yyyy.length === 2 ? "20" + yyyy : yyyy);
    const D = new Date(Y, Number(mm) - 1, Number(dd), Number(HH), Number(MM), Number(SS));
    return isNaN(D) ? null : D;
  }

  return null;
}

function formatRangeDate(values) {
  const dates = values.map(parseDateLoose).filter(Boolean);
  if (!dates.length) return "—";
  const min = new Date(Math.min(...dates));
  const max = new Date(Math.max(...dates));
  const fmt = (d) => d.toISOString().slice(0,10);
  return `${fmt(min)} → ${fmt(max)}`;
}

function uniqueSorted(values) {
  const set = new Set(values.filter(v => v !== null && v !== undefined && normStr(v) !== ""));
  return [...set].sort((a, b) => normStr(a).localeCompare(normStr(b), "es", { numeric: true, sensitivity: "base" }));
}

/* ==================================
   Lectura de criterios.xlsx (carpeta raíz)
   ================================== */
async function loadCriterios() {
  const res = await fetch("criterios.xlsx?ts=" + Date.now(), { cache: "no-store" });
  if (!res.ok) throw new Error("No se pudo cargar criterios.xlsx");
  const ab = await res.arrayBuffer();
  const wb = XLSX.read(ab, { type: "array" });
  const sh = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sh, { defval: null });
  return rows.map(r => ({
    name: normStr(r["Nombre normalizado"]) || null,
    tipo: normStr(r["Tipo"]) || null,
    filtro: isTruthySi(r["Permitir filtro"]),
    map: {
      CA: normStr(r["CA"]) || null,
      CEPLAN: normStr(r["CEPLAN"]) || null,
      SIGA: normStr(r["SIGA"]) || null
    }
  })).filter(x => x.name);
}

/* ==============================
   Lectura de archivos de usuario
   ============================== */
function parseCSVFile(file, opts = {}) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter: opts.delimiter || "",
      transformHeader: (h) => normStr(h),
      complete: (res) => resolve(res.data),
      error: (err) => reject(err)
    });
  });
}

async function readUserFile(file) {
  if (!file) return [];
  const name = (file.name || "").toLowerCase();
  if (name.endsWith(".txt")) return parseCSVFile(file, { delimiter: "\t" }); // SIGA (tabs)
  return parseCSVFile(file); // CSV
}

/* ==========================================
   Normalización de datasets según criterios
   ========================================== */
function normalizeDataset(rows, datasetKey, criterios) {
  if (!rows?.length) return [];
  const invMap = {};
  criterios.forEach(c => {
    const src = c.map?.[datasetKey];
    if (src) invMap[src] = c.name;
  });
  const headers = Object.keys(rows[0] || {}).map(h => h.toLowerCase());
  const ciIndex = {};
  Object.keys(invMap).forEach(orig => {
    const i = headers.indexOf(orig.toLowerCase());
    if (i >= 0) ciIndex[headers[i]] = invMap[orig];
  });

  return rows.map(r => {
    const out = {};
    for (const k in r) {
      const keyLow = k.toLowerCase();
      const mapped = invMap[k] || ciIndex[keyLow];
      if (mapped) out[mapped] = r[k];
    }
    return out;
  });
}

/* =========================
   Inclusiones (filtros ON)
   ========================= */
function applyInclusions(rows, var2inclusions) {
  if (!rows?.length) return [];
  if (!var2inclusions) return rows;
  return rows.filter(row => {
    for (const [varName, set] of Object.entries(var2inclusions)) {
      if (!set || set.size === 0) continue; // sin selección => no filtra
      const v = normStr(row[varName]);
      if (!set.has(v)) return false; // incluir solo seleccionados
    }
    return true;
  });
}

/* =========================
   Componentes de la interfaz
   ========================= */

// Colores por dataset para el gráfico
const DS_COLORS = {
  CA: "#36A2EB",
  CEPLAN: "#FF6384",
  SIGA: "#62c462",
};

// === Ticks "redondos" (1, 2, 5 × 10^k)
function niceTicks(max, target = 5) {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const bases = [1, 2, 5];
  const exp = Math.floor(Math.log10(max));
  let chosenStep = Math.pow(10, exp);
  let best = Infinity;

  for (let e = exp - 1; e <= exp + 1; e++) {
    const pow = Math.pow(10, e);
    for (const b of bases) {
      const step = b * pow;
      const ticks = Math.ceil(max / step);
      const score = Math.abs(ticks - target);
      if (ticks >= 2 && score < best) {
        best = score;
        chosenStep = step;
      }
    }
  }

  const niceMax = Math.ceil(max / chosenStep) * chosenStep;
  const arr = [];
  for (let v = 0; v <= niceMax + 1e-9; v += chosenStep) arr.push(v);
  return arr.length >= 2 ? arr : [0, niceMax || max];
}

// Gráfico de barras (SVG) por variable con color del dataset propietario.
// Mantiene el ORDEN de aparición de las variables "Num suma" en la tabla (sin ordenar por valor).
function BarsChart({ data, title }) {
  if (!data?.length) {
    return (
      <div className="space-y-3 text-slate-700">
        {title && <div className="font-medium">{title}</div>}
        <div className="text-sm text-slate-500">No hay variables con suma &gt; 0.</div>
      </div>
    );
  }

  const maxVal = Math.max(1, ...data.map(d => d.value));
  const fmt = (n) => new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(n);

  const marks = niceTicks(maxVal, 5);
  const yMax = marks[marks.length - 1] || maxVal;

  // Márgenes dinámicos para etiquetas grandes
  const widestTick = marks.map(fmt).reduce((a, b) => (a.length > b.length ? a : b), "");
  const pad = {
    top: 36,
    right: 24,
    bottom: 52,
    left: Math.max(56, 10 + widestTick.length * 8)
  };

  const width  = Math.max(360, data.length * 90 + pad.left + pad.right);
  const height = 300;
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const xStep  = innerW / data.length;
  const barW   = Math.min(60, xStep * 0.6);

  return (
    <div className="space-y-3 text-slate-700">
      {title && <div className="font-medium">{title}</div>}
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title || "Bar chart"}>
        {/* Guías horizontales con valores "bonitos" */}
        {marks.map((m, i) => {
          const y = height - pad.bottom - (innerH * (m / yMax));
          return (
            <g key={"y"+i}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" />
              <text x={pad.left - 6} y={y + 4} fontSize="11" textAnchor="end">{fmt(m)}</text>
            </g>
          );
        })}

        {/* Eje base */}
        <line
          x1={pad.left} x2={width - pad.right}
          y1={height - pad.bottom} y2={height - pad.bottom}
          stroke="currentColor" strokeOpacity="0.2"
        />

        {data.map((d, i) => {
          const x = pad.left + i * xStep + (xStep - barW) / 2;
          const h = innerH * (d.value / yMax);
          const y = height - pad.bottom - h;
          const valueY = Math.max(y - 6, pad.top + 12); // evita corte superior

          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={h} rx="8" fill={d.color || "currentColor"} opacity="0.85" />
              <text x={x + barW / 2} y={valueY} textAnchor="middle" fontSize="12">{fmt(d.value)}</text>
              <text x={x + barW / 2} y={height - pad.bottom + 18} textAnchor="middle" fontSize="12">{d.label}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function UploadCard({ label, accept, onFile }) {
  const id = label.replace(/\s+/g, "_");
  return (
    <div className="card p-4 space-y-3">
      <div className="text-sm text-slate-500">{label}</div>
      <input
        id={id}
        type="file"
        accept={accept}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
        className="input"
      />
      <div className="text-xs text-slate-500">
        {label.includes("SIGA") ? "TXT separado por TAB" : "CSV con encabezados"}
      </div>
    </div>
  );
}

/* ====== Ayuda (modal) ====== */
/* ====== Ayuda (modal) ====== */
function HelpModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal max-w-3xl" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Ayuda</h3>
          <button className="btn-alt" onClick={onClose}>Cerrar</button>
        </div>

        <div className="space-y-4 text-sm">
          <div>
            <h4 className="font-medium mb-1">
              ¿Cómo obtener los datos de <span className="font-semibold">SIGA</span> (TXT con tabs)?
            </h4>
            <div className="p-3 rounded-lg bg-slate-50 border text-slate-700">
              {/* ← Completar con el paso a paso específico del SIGA → */}
              <ol className="list-decimal list-inside space-y-1">
                <li><em>Instrucción 1 (pendiente)…</em></li>
                <li><em>Instrucción 2 (pendiente)…</em></li>
                <li><em>Exportar.</em></li>
              </ol>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-1">
              ¿Cómo obtener <span className="font-semibold">CEPLAN</span> y <span className="font-semibold">CA</span> (CSV)?
            </h4>
            <ol className="list-decimal list-inside space-y-1">
              <li>
                Descarga el ejecutable{" "}
                <a className="link" href="scraper.exe" download>scraper.exe</a>.
              </li>
              <li>Ejecuta el archivo y sigue las instrucciones para elegir entidad y periodo.</li>
              <li>El programa exporta archivos <strong>CSV con encabezados</strong> para CEPLAN y CA.</li>
              <li>Vuelve a esta página y cárgalos en “Archivo CEPLAN (CSV)” y “Archivo CA (CSV)”.</li>
            </ol>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <a className="btn" href="scraper.exe" download>Descargar scraper.exe</a>
        </div>
      </div>
    </div>
  );
}

function FilterModal({ open, onClose, varName, perDatasetValues, currentIncl, onApply }) {
  const dsList = ["CA","CEPLAN","SIGA"].filter(ds => (perDatasetValues?.[ds]?.length || 0) > 0);
  const [local, setLocal] = useState(() => {
    const o = {};
    for (const ds of dsList) {
      const cur = currentIncl?.[ds] || new Set();
      o[ds] = new Set(cur);
    }
    return o;
  });

  useEffect(() => {
    if (open) {
      const o = {};
      for (const ds of dsList) {
        const cur = currentIncl?.[ds] || new Set();
        o[ds] = new Set(cur);
      }
      setLocal(o);
    }
  }, [open]);

  if (!open) return null;

  const toggle = (ds, v) => {
    const s = new Set(local[ds] || []);
       const key = normStr(v);
    if (s.has(key)) s.delete(key); else s.add(key);
    setLocal(prev => ({ ...prev, [ds]: s }));
  };

  const bulk = (ds, type) => {
    const vals = perDatasetValues?.[ds] || [];
    const next = new Set(type === "all" ? vals.map(normStr) : []); // all = incluir todos
    setLocal(prev => ({ ...prev, [ds]: next }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">Filtrar “{varName}”</h3>
          <button className="btn-alt" onClick={onClose}>Cerrar</button>
        </div>

        {dsList.length === 0 && (
          <div className="text-sm text-slate-500">No hay datasets con esta variable.</div>
        )}

        <div className={`grid gap-4 ${dsList.length===3 ? "sm:grid-cols-3" : dsList.length===2 ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
          {dsList.map(ds => (
            <div key={ds} className="border rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium">{ds}</div>
                <div className="space-x-1">
                  <button className="btn-alt" onClick={()=>bulk(ds,"none")}>Limpiar</button>
                  <button className="btn-alt" onClick={()=>bulk(ds,"all")}>Todo</button>
                </div>
              </div>
              <div className="space-y-1 max-h-80 overflow-auto pr-1">
                {(perDatasetValues?.[ds]||[]).map(v => (
                  <label key={ds+"|"+normStr(v)} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={local[ds]?.has(normStr(v)) || false}
                      onChange={()=>toggle(ds, v)}
                    />
                    <span className="break-words">{normStr(v) || <i>(vacío)</i>}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button className="btn-alt" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={() => onApply(local)}>Aplicar filtros</button>
        </div>
      </div>
    </div>
  );
}

/* ==========================
   Vista de comparaciones
   ========================== */
const dsClass = (ds) => ds === "CA" ? "col-ca" : ds === "CEPLAN" ? "col-ce" : "col-si";

function VersusTable({ leftName, rightName, leftRows, rightRows, criterios }) {
  const resumenCriterios = criterios.filter(c => c.tipo?.toLowerCase().includes("para resumen"));
  const listas = criterios.filter(c => c.tipo === "Lista");
  const nums = criterios.filter(c => c.tipo === "Num suma");

  const countLeft = leftRows.length;
  const countRight = rightRows.length;

  // === Grilla de barras: una barra por variable "Num suma", en EL MISMO ORDEN que aparece en la tabla (sin ordenar por valor).
  // Color según dataset propietario por mapeo de criterios (no según valor). Altura y etiqueta = suma del propietario.
  const barsData = nums.map(c => {
    const leftHas = !!c.map?.[leftName];
    const rightHas = !!c.map?.[rightName];
    const sumLeft = leftRows.reduce((acc, r) => acc + parseNumberLoose(r[c.name]), 0);
    const sumRight = rightRows.reduce((acc, r) => acc + parseNumberLoose(r[c.name]), 0);

    let owner = leftName;
    if (leftHas && !rightHas) owner = leftName;
    else if (!leftHas && rightHas) owner = rightName;
    else if (leftHas && rightHas) owner = leftName;
    else owner = leftName;

    const value = owner === leftName ? sumLeft : sumRight;

    return { label: c.name, value, color: DS_COLORS[owner] || "#888888" };
  }).filter(d => d.value > 0); // solo mayores a 0

  const renderResumenItem = (c) => {
    const title = c.name;
    const isRango = c.tipo.toLowerCase().includes("(rango)");
    const isUnicos = c.tipo.toLowerCase().includes("(valores únicos)");
    const lv = leftRows.map(r => r[title]);
    const rv = rightRows.map(r => r[title]);

    let leftVal = "—", rightVal = "—";
    if (isRango) {
      leftVal = formatRangeDate(lv);
      rightVal = formatRangeDate(rv);
    } else if (isUnicos) {
      leftVal = uniqueSorted(lv).join(" · ") || "—";
      rightVal = uniqueSorted(rv).join(" · ") || "—";
    }

    return (
      <tr key={title} className="border-t">
        <td className="py-2 pr-2">{title}</td>
        <td className={`py-2 px-3 ${dsClass(leftName)}`}>
          <div style={{maxHeight:'260px', overflowY:'auto', wordBreak:'break-word', whiteSpace:'pre-wrap'}}>{leftVal}</div>
        </td>
        <td className={`py-2 px-3 ${dsClass(rightName)}`}>
          <div style={{maxHeight:'260px', overflowY:'auto', wordBreak:'break-word', whiteSpace:'pre-wrap'}}>{rightVal}</div>
        </td>
      </tr>
    );
  };

  const renderListaRow = (c) => {
    const title = c.name;
    const L = uniqueSorted(leftRows.map(r => r[title]));
    const R = uniqueSorted(rightRows.map(r => r[title]));
    return (
      <tr key={"lista-"+title} className="align-top border-t">
        <td className="py-2 pr-2 font-medium">{title}</td>
        <td className={`py-2 px-3 ${dsClass(leftName)}`}>
          <div style={{maxHeight:'260px', overflowY:'auto'}}>
            <ul className="list-disc list-inside space-y-0.5">
              {L.length ? L.map((x,i) => <li key={"L"+title+i} className="break-words">{normStr(x)}</li>) : <li className="text-slate-400">—</li>}
            </ul>
          </div>
        </td>
        <td className={`py-2 px-3 ${dsClass(rightName)}`}>
          <div style={{maxHeight:'260px', overflowY:'auto'}}>
            <ul className="list-disc list-inside space-y-0.5">
              {R.length ? R.map((x,i) => <li key={"R"+title+i} className="break-words">{normStr(x)}</li>) : <li className="text-slate-400">—</li>}
            </ul>
          </div>
        </td>
      </tr>
    );
  };

  const renderNumRow = (c) => {
    const title = c.name;
    const sumLeft = leftRows.reduce((acc, r) => acc + parseNumberLoose(r[title]), 0);
    const sumRight = rightRows.reduce((acc, r) => acc + parseNumberLoose(r[title]), 0);
    const fmt = (n) => new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(n);
    return (
      <tr key={"num-"+title} className="border-t">
        <td className="py-2 pr-2 font-medium">{title}</td>
        <td className={`py-2 px-3 ${dsClass(leftName)}`}>{fmt(sumLeft)}</td>
        <td className={`py-2 px-3 ${dsClass(rightName)}`}>{fmt(sumRight)}</td>
      </tr>
    );
  };

  // Layout: tablas a la izquierda, gráfico a la derecha (debajo en pantallas pequeñas)
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="text-sm text-slate-600">Filas</div>
            <span className="badge">{leftName}: {countLeft}</span>
            <span className="badge">{rightName}: {countRight}</span>
          </div>
          <div className="overflow-auto">
            <table className="table-modern">
              <colgroup>
                <col className="varcol" />
                <col className="halfcol" />
                <col className="halfcol" />
              </colgroup>
              <thead>
                <tr>
                  <th className="py-2 pr-2">Variable (resumen)</th>
                  <th className={`py-2 px-3 ${dsClass(leftName)}`}>{leftName}</th>
                  <th className={`py-2 px-3 ${dsClass(rightName)}`}>{rightName}</th>
                </tr>
              </thead>
              <tbody>
                {resumenCriterios.map(renderResumenItem)}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-4">
          <div className="overflow-auto">
            <table className="table-modern">
              <colgroup>
                <col className="varcol" />
                <col className="halfcol" />
                <col className="halfcol" />
              </colgroup>
              <thead>
                <tr>
                  <th className="py-2 pr-2">Variable</th>
                  <th className={`py-2 px-3 ${dsClass(leftName)}`}>{leftName}</th>
                  <th className={`py-2 px-3 ${dsClass(rightName)}`}>{rightName}</th>
                </tr>
              </thead>
              <tbody>
                {listas.map(renderListaRow)}
                {nums.map(renderNumRow)}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <BarsChart
          data={barsData}
          title="Suma por variable (solo &gt; 0) — orden de la tabla"
        />
      </div>
    </div>
  );
}

/* ===================
   App principal
   =================== */
function App() {
  const [criterios, setCriterios] = useState(null);
  const [caFile, setCaFile] = useState(null);
  const [ceFile, setCeFile] = useState(null);
  const [siFile, setSiFile] = useState(null);

  const [raw, setRaw] = useState({ CA: [], CEPLAN: [], SIGA: [] });
  const [norm, setNorm] = useState({ CA: [], CEPLAN: [], SIGA: [] });

  // Routing simple por hash (#inicio | #resultados)
  const [route, setRoute] = useState("inicio");
  const [filterVar, setFilterVar] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const sync = () => setRoute((location.hash || "#inicio").slice(1));
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Métricas rápidas
  const [stats, setStats] = useState({ CA:null, CEPLAN:null, SIGA:null });

  useEffect(() => {
    loadCriterios().then(setCriterios).catch(e => {
      console.error(e);
      alert("No se pudo leer criterios.xlsx. Colócalo junto a index.html.");
    });
  }, []);

  const filtroVars = useMemo(() => (criterios || []).filter(c => c.filtro), [criterios]);

  async function handleSelect(ds, file) {
    if (ds === 'CA') setCaFile(file);
    if (ds === 'CEPLAN') setCeFile(file);
    if (ds === 'SIGA') setSiFile(file);

    if (!file) {
      setRaw(prev => ({ ...prev, [ds]: [] }));
      setNorm(prev => ({ ...prev, [ds]: [] }));
      setStats(prev => ({ ...prev, [ds]: null }));
      return;
    }
    try {
      const data = await readUserFile(file);
      setRaw(prev => ({ ...prev, [ds]: data }));

      if (criterios) {
        const normalized = normalizeDataset(data, ds, criterios);
        setNorm(prev => ({ ...prev, [ds]: normalized }));
        setStats(prev => ({ ...prev, [ds]: computeStats(ds, normalized, criterios) }));
      }
    } catch (e) {
      console.error(e);
      alert(`Error al leer ${ds}.`);
    }
  }

  useEffect(() => {
    if (!criterios) return;
    const nextNorm = { ...norm };
    const nextStats = { ...stats };
    for (const ds of ["CA","CEPLAN","SIGA"]) {
      const data = raw[ds];
      if (!data?.length) { nextNorm[ds]=[]; nextStats[ds]=null; continue; }
      const normalized = normalizeDataset(data, ds, criterios);
      nextNorm[ds] = normalized;
      nextStats[ds] = computeStats(ds, normalized, criterios);
    }
    setNorm(nextNorm);
    setStats(nextStats);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criterios]);

  function computeStats(dsKey, rows, criterios) {
    if (!rows?.length) return { rows:0, nums:[] };
    const numCrits = (criterios || []).filter(c => c.tipo === "Num suma");
    const nums = numCrits.map(c => {
      const arr = rows.map(r => r[c.name]);
      const valid = arr.map(parseNumberLoose).filter(n => Number.isFinite(n));
      const sum = valid.reduce((a,b)=>a+b,0);
      const avg = valid.length ? sum/valid.length : 0;
      return { name:c.name, sum, avg };
    });
    return { rows: rows.length, nums };
  }

  const perVarValues = useMemo(() => {
    if (!criterios) return {};
    const out = {};
    for (const c of filtroVars) {
      out[c.name] = {
        CA: c.map?.CA ? uniqueSorted(norm.CA.map(r => r[c.name])) : [],
        CEPLAN: c.map?.CEPLAN ? uniqueSorted(norm.CEPLAN.map(r => r[c.name])) : [],
        SIGA: c.map?.SIGA ? uniqueSorted(norm.SIGA.map(r => r[c.name])) : [],
      };
    }
    return out;
  }, [norm, criterios, filtroVars]);

  // Inclusiones aplicadas por dataset
  const [inclusions, setInclusions] = useState({});
  const filtered = useMemo(() => {
    const perDS = { CA: {}, CEPLAN: {}, SIGA: {} };
    for (const [varName, byDS] of Object.entries(inclusions)) {
      for (const ds of ["CA","CEPLAN","SIGA"]) {
        if (!byDS?.[ds] || byDS[ds].size === 0) continue;
        perDS[ds][varName] = byDS[ds];
      }
    }
    return {
      CA: applyInclusions(norm.CA, perDS.CA),
      CEPLAN: applyInclusions(norm.CEPLAN, perDS.CEPLAN),
      SIGA: applyInclusions(norm.SIGA, perDS.SIGA),
    };
  }, [norm, inclusions]);

  const ready = !!criterios && (norm.CA.length || norm.CEPLAN.length || norm.SIGA.length);
  const canCompare = filtered.CA.length || filtered.CEPLAN.length || filtered.SIGA.length;

  const [activeTab, setActiveTab] = useState("CA_CEPLAN");
  const activeLeftRight = useMemo(() => {
    if (activeTab === "CA_CEPLAN") return ["CA","CEPLAN"];
    if (activeTab === "CA_SIGA") return ["CA","SIGA"];
    return ["CEPLAN","SIGA"];
  }, [activeTab]);

  return (
    <div className="container py-6 space-y-6">
      {/* Header institucional */}
      <header className="header-wrap">
        <div className="header-inner">
          <div className="header-logos">
            <img className="brandimg" src="images/gfp_darkbg.png" alt="GFP Subnacional" />
            <img className="brandimg" src="images/suiza_darkbg.png" alt="Cooperación Suiza SECO" />
            <img className="brandimg" src="images/basel_darkbg.png" alt="Basel Institute on Governance" />
          </div>
          <div className="grow" />
            <div className="flex items-end gap-2">
            <div className="text-right">
                <div className="header-title">Seguimiento financiero</div>
                <div className="header-sub">Comparador CA / CEPLAN / SIGA</div>
            </div>
            <button className="btn-alt h-9" onClick={()=>setHelpOpen(true)}>Ayuda</button>
            </div>
        </div>
      </header>

      {/* ======= INICIO ======= */}
      {route === "inicio" && (
        <>
          <section className="grid md:grid-cols-3 gap-4">
            <UploadCard label="Archivo CA (CSV)" accept=".csv,text/csv" onFile={(f)=>handleSelect('CA',f)} />
            <UploadCard label="Archivo CEPLAN (CSV)" accept=".csv,text/csv" onFile={(f)=>handleSelect('CEPLAN',f)} />
            <UploadCard label="Archivo SIGA (TXT con tabs)" accept=".txt,text/plain" onFile={(f)=>handleSelect('SIGA',f)} />
          </section>

          {/* Métricas rápidas */}
          <div className="card p-4">
            <div className="text-sm text-slate-600 mb-3">Resumen rápido</div>
            <div className="grid sm:grid-cols-3 gap-4">
              {["CA","CEPLAN","SIGA"].map(ds => (
                <div key={ds} className="border rounded-xl p-3">
                  <div className="font-medium mb-1">{ds}</div>
                  {!stats[ds] ? (
                    <div className="text-xs text-slate-400">Sin datos</div>
                  ) : (
                    <>
                      <div className="text-sm mb-2">Filas: <span className="font-semibold">{stats[ds].rows}</span></div>
                      <div className="space-y-1">
                        {stats[ds].nums.map(n => (
                          <div key={ds+"|"+n.name} className="text-xs">
                            <div className="font-medium">{n.name}</div>
                            <div>Suma: {new Intl.NumberFormat("es-PE",{maximumFractionDigits:2}).format(n.sum)}</div>
                            <div>Promedio: {new Intl.NumberFormat("es-PE",{maximumFractionDigits:2}).format(n.avg)}</div>
                          </div>
                        ))}
                        {!stats[ds].nums.length && <div className="text-xs text-slate-400">Sin variables numéricas</div>}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Filtros dinámicos */}
          <div className="card p-4">
            <div className="mb-2 text-sm text-slate-600">Filtros disponibles (inclusión):</div>
            <div className="flex flex-wrap gap-2">
              {(criterios || []).filter(c=>c.filtro).map(f => (
                <button
                  key={f.name}
                  className="btn"
                  disabled={!ready}
                  onClick={() => setFilterVar(f.name)}
                  title="Incluir valores por dataset"
                >
                  Filtrar por {f.name}
                </button>
              ))}
              {!(criterios || []).some(c=>c.filtro) && <div className="text-sm text-slate-400">No hay filtros definidos.</div>}
            </div>
          </div>

          {/* Acción de comparar */}
          <div className="flex items-center gap-2">
            <button
              className="btn"
              disabled={!ready || !canCompare}
              onClick={() => { location.hash = "resultados"; }}
            >
              Procesar comparación
            </button>
            <button
              className="btn-alt"
              onClick={() => { setInclusions({}); alert("Filtros limpiados."); }}
            >
              Limpiar filtros
            </button>
          </div>
        </>
      )}

      {/* ======= RESULTADOS ======= */}
      {route === "resultados" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <button className={`tab ${activeTab==="CA_CEPLAN" ? "tab-active" : ""}`} onClick={()=>setActiveTab("CA_CEPLAN")}>CA vs CEPLAN</button>
              <button className={`tab ${activeTab==="CA_SIGA" ? "tab-active" : ""}`} onClick={()=>setActiveTab("CA_SIGA")}>CA vs SIGA</button>
              <button className={`tab ${activeTab==="CEPLAN_SIGA" ? "tab-active" : ""}`} onClick={()=>setActiveTab("CEPLAN_SIGA")}>CEPLAN vs SIGA</button>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-alt" onClick={()=>setHelpOpen(true)}>Ayuda</button>
              <button className="btn-alt" onClick={()=>{ location.hash = "inicio"; }}>← Volver</button>
            </div>
          </div>

          <VersusTable
            leftName={activeLeftRight[0]}
            rightName={activeLeftRight[1]}
            leftRows={filtered[activeLeftRight[0]]}
            rightRows={filtered[activeLeftRight[1]]}
            criterios={(criterios || []).filter(c => c.tipo)}
          />
        </section>
      )}

      {/* Modales */}
      <HelpModal open={helpOpen} onClose={()=>setHelpOpen(false)} />

      <FilterModal
        open={!!filterVar}
        onClose={()=>setFilterVar(null)}
        varName={filterVar || ""}
        perDatasetValues={filterVar ? {
          CA: (criterios||[]).find(c=>c.name===filterVar)?.map?.CA ? uniqueSorted(norm.CA.map(r => r[filterVar])) : [],
          CEPLAN: (criterios||[]).find(c=>c.name===filterVar)?.map?.CEPLAN ? uniqueSorted(norm.CEPLAN.map(r => r[filterVar])) : [],
          SIGA: (criterios||[]).find(c=>c.name===filterVar)?.map?.SIGA ? uniqueSorted(norm.SIGA.map(r => r[filterVar])) : [],
        } : {}}
        currentIncl={{
          CA: new Set(inclusions[filterVar]?.CA || []),
          CEPLAN: new Set(inclusions[filterVar]?.CEPLAN || []),
          SIGA: new Set(inclusions[filterVar]?.SIGA || []),
        }}
        onApply={(byDS) => {
          setInclusions(prev => ({
            ...prev,
            [filterVar]: {
              CA: byDS.CA || new Set(),
              CEPLAN: byDS.CEPLAN || new Set(),
              SIGA: byDS.SIGA || new Set()
            }
          }));
          setFilterVar(null); 
        }}
      />
    </div>
  );
} 

ReactDOM.createRoot(document.getElementById("root")).render(<App />);

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

// Paleta única para PieChart y BarsChart (misma en todos lados)
const PALETTE = [
  "#2563EB","#16A34A","#F59E0B","#EF4444","#8B5CF6",
  "#06B6D4","#84CC16","#F97316","#DB2777","#0EA5E9",
  "#22C55E","#EAB308","#DC2626","#A855F7","#10B981"
];

function PagedList({ items, batch = 15 }) {
  const [shown, setShown] = React.useState(batch);
  const visible = items.slice(0, shown);
  const remaining = Math.max(0, items.length - shown);

  return (
    <div className="space-y-1">
      <ul className="list-disc list-inside space-y-0.5 text-sm">
        {visible.length ? visible.map((x,i)=>
          <li key={i} className="break-words">{x}</li>
        ) : <li className="text-slate-400">—</li>}
      </ul>
      {remaining > 0 && (
        <button className="btn-alt mt-2"
          onClick={()=> setShown(s => s + batch)}>
          Ver más ({remaining})
        </button>
      )}
    </div>
  );
}


const fmtMoney = (n) => "S/ " + new Intl.NumberFormat("es-PE", {
  maximumFractionDigits: 0, minimumFractionDigits: 0
}).format(n);

const fmtPct0 = (p) => new Intl.NumberFormat("es-PE", {
  style: "percent", maximumFractionDigits: 0, minimumFractionDigits: 0
}).format(p);


function collapseSmall(items, minPct = 0.06, otrosLabel = "Otros") {
  const valid = (items || []).filter(d => Number.isFinite(d?.value) && d.value > 0);
  const total = valid.reduce((a, b) => a + b.value, 0);
  if (total <= 0) return [];

  const big = [];
  let otros = 0;
  for (const d of valid) {
    const pct = d.value / total;
    if (pct < minPct) otros += d.value; else big.push({ label: d.label, value: d.value });
  }

  // Ordena grandes (desc) y empuja "Otros" al final si corresponde
  big.sort((a,b) => b.value - a.value);
  if (otros > 0) big.push({ label: otrosLabel, value: otros });

  return big;
}

const OTHERS_LABEL = "Otros";
const OTHERS_COLOR = "#9CA3AF"; // gris fijo

function withPalette(items) {
  let pi = 0;
  return (items || []).map((d) => {
    if (d?.color) return d; // <- respeta color preasignado (p.ej. según fuente en versus)
    const color = PALETTE[pi % PALETTE.length];
    pi++;
    return { ...d, color };
  });
}


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
  const fmt = (d) => d.toISOString().slice(0,10); // yyyy-mm-dd
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
    tipoVersus: normStr(r["Tipo para versus"]) || null,
    tipoInd: normStr(r["Tipo para individuales"]) || null,
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
// Gráfico de barras (SVG) por variable con owner-color.
// Añade: envoltura de etiquetas (tspan) y ancho máximo opcional.
function BarsChart({ data, title, maxWidth = 350, collapsePct = 0.06 }) {
  const base = (collapsePct == null) ? (data || []) : collapseSmall(data, collapsePct);
  const prepared = withPalette(base);
  if (!prepared.length) {
    return (
      <div className="space-y-3 text-slate-700">
        {title && <div className="font-medium">{title}</div>}
        <div className="text-sm text-slate-500">No hay variables con suma &gt; 0.</div>
      </div>
    );
  }

  const maxVal = Math.max(1, ...prepared.map(d => d.value));
  const fmtAxis = fmtMoney; // ticks con S/ y 0 decimales

  const marks = niceTicks(maxVal, 5);
  const yMax = marks[marks.length - 1] || maxVal;

  // Márgenes y altura dinámicos: banda para labels bajo el eje
  const widestTick = marks.map(fmtAxis).reduce((a, b) => (a.length > b.length ? a : b), "");
  const pad = {
    top: 36,
    right: 24,
    bottom: 32, // ya no reservamos banda para etiquetas
    left: Math.max(56, 10 + widestTick.length * 8)
  };

  const width  = Math.min(maxWidth, Math.max(360, prepared.length * 90 + pad.left + pad.right));
  const BASE_PLOT_H = 220; // altura del área de barras (sin labels)
  const height = pad.top + BASE_PLOT_H + pad.bottom; // altura total ADAPTATIVA
  const innerW = width - pad.left - pad.right;
  const innerH = BASE_PLOT_H; // altura del área de barras fija
  const xStep  = innerW / prepared.length;
  const barW   = Math.min(52, xStep * 0.6);

  return (
    <div className="space-y-3 text-slate-700">
      {title && <div className="font-medium">{title}</div>}
      {/* CONTENEDOR CON LIMITE DE ANCHO */}
      <div style={{ maxWidth: `${maxWidth}px`, width: "100%", margin: "0 auto" }}>
        <svg
          style={{ width: "100%", height: "auto", display: "block" }}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title || "Bar chart"}
        >
          {/* Guías horizontales */}
          {marks.map((m, i) => {
            const y = height - pad.bottom - (innerH * (m / yMax));
            return (
              <g key={"y"+i}>
                <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="currentColor" strokeOpacity="0.08" />
                <text x={pad.left - 6} y={y + 4} fontSize="11" textAnchor="end">{fmtAxis(m)}</text>
              </g>
            );
          })}

          {/* Eje base */}
          <line
            x1={pad.left} x2={width - pad.right}
            y1={height - pad.bottom} y2={height - pad.bottom}
            stroke="currentColor" strokeOpacity="0.2"
          />

          {prepared.map((d, i) => {
            const x = pad.left + i * xStep + (xStep - barW) / 2;
            const h = innerH * (d.value / yMax);
            const y = height - pad.bottom - h;
            const valueY = Math.max(y - 6, pad.top + 12);

            const baseline = height - pad.bottom + 18; // SIEMPRE debajo del eje

            return (
              <g key={d.label}>
                <rect x={x} y={y} width={barW} height={h} rx="8" fill={d.color || "currentColor"} opacity="0.85" />
                <text x={x + barW / 2} y={valueY} textAnchor="middle" fontSize="12">{fmtMoney(d.value)}</text>
              </g>
            );
          })}
        </svg>

        {/* Leyenda de colores (igual que PieChart) */}
        <div className="mt-3 space-y-1">
          {prepared.map((d,i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: d.color }} />
              <span className="break-words">{d.label}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

// Gráfico de pie (SVG) simple
// Gráfico de pie (SVG) con paleta de colores automática y ancho máximo controlado
function PieChart({ data, title, size = 280, maxWidth = 350 }) {
  // Filtrar datos válidos
  const filtered  = (data || []).filter(d => Number.isFinite(d.value) && d.value > 0);
  const collapsed = collapseSmall(filtered, 0.06);

  // Forzar “Otros” con gris fijo y SIN consumir índice de la paleta
  const enforced  = collapsed.map(d =>
    d.label === OTHERS_LABEL ? { ...d, color: OTHERS_COLOR } : d
  );

  const colored   = withPalette(enforced);
  const totalColored = colored.reduce((a, b) => a + b.value, 0);

  if (!colored.length || totalColored <= 0) {
    return (
      <div className="space-y-3 text-slate-700">
        {title && <div className="font-medium">{title}</div>}
        <div className="text-sm text-slate-500">Sin datos para el gráfico.</div>
      </div>
    );
  }

  const cx = size / 2, cy = size / 2, r = size * 0.38;
  let angleAcc = -Math.PI / 2;
  const toXY = (ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];

  // Si hay un solo valor, dibuja un círculo completo con la etiqueta centrada
  if (colored.length === 1) {
    const d = colored[0];
    const valTxt = fmtMoney(d.value);
    const pctTxt = fmtPct0(1);

    return (
      <div className="space-y-3 text-slate-700">
        {title && <div className="font-medium">{title}</div>}
        <div style={{ maxWidth: `${maxWidth}px`, width: "100%", margin: "0 auto" }}>
          <svg
            style={{ width: "100%", height: "auto", display: "block" }}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={title || "Pie chart"}
          >
            <circle cx={cx} cy={cy} r={r} fill={d.color} opacity="0.9" />
            {/* Etiqueta centrada (valor y 100%) con halo para legibilidad */}
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                  fontSize="12" stroke="rgba(0,0,0,0.35)" strokeWidth="2" paintOrder="stroke">
              {`${valTxt} (${pctTxt})`}
            </text>
            <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle"
                  fontSize="12" fill="#fff">
              {`${valTxt} (${pctTxt})`}
            </text> 
          </svg>
        </div>

        {/* Leyenda SOLO con la etiqueta */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: d.color }} />
              <span className="break-words">{d.label || "(sin etiqueta)"}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Caso general (2+ valores): porciones + texto interno (valor y %) y LEYENDA SOLO con la etiqueta
  return (
    <div className="space-y-3 text-slate-700">
      {title && <div className="font-medium">{title}</div>}
      <div style={{ maxWidth: `${maxWidth}px`, width: "100%", margin: "0 auto" }}>
        <svg
          style={{ width: "100%", height: "auto", display: "block" }}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={title || "Pie chart"}
        >
        {/* 1) DIBUJAR TODAS LAS PORCIONES */}
        {(() => {
          let aacc = -Math.PI / 2;
          return colored.map((d, idx) => {
            const ang = (d.value / totalColored) * Math.PI * 2;
            const a0 = aacc;
            const a1 = aacc + ang;
            aacc = a1;

            const [x0, y0] = toXY(a0);
            const [x1, y1] = toXY(a1);
            const largeArc = ang > Math.PI ? 1 : 0;

            const path = [
              `M ${cx} ${cy}`,
              `L ${x0} ${y0}`,
              `A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1}`,
              "Z"
            ].join(" ");

            return <path key={"slice-"+idx} d={path} fill={d.color} opacity="0.9" />;
          });
        })()}

        {/* 2) LUEGO TODAS LAS ETIQUETAS (ENCIMA) */}
        {(() => {
          let aacc = -Math.PI / 2;
          return colored.map((d, idx) => {
            const ang = (d.value / totalColored) * Math.PI * 2;
            const a0 = aacc;
            const a1 = aacc + ang;
            aacc = a1;

            const mid = (a0 + a1) / 2;
            const rLabel = r * 0.62; // misma posición interna
            const lx = cx + rLabel * Math.cos(mid);
            const ly = cy + rLabel * Math.sin(mid);
            const pct = totalColored > 0 ? (d.value / totalColored) : 0;
            const valTxt = fmtMoney(d.value);
            const pctTxt = fmtPct0(pct);

            return (
              <g key={"label-"+idx}>
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="11"
                  stroke="rgba(0,0,0,0.35)"
                  strokeWidth="2"
                  paintOrder="stroke"
                >
                  {`${valTxt} (${pctTxt})`}
                </text>
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize="11"
                  fill="#fff"
                >
                  {`${valTxt} (${pctTxt})`}
                </text>
              </g>
            );
          });
        })()}
        </svg>
      </div>

      {/* Leyenda SOLO con la etiqueta */}
      <div className="space-y-1">
        {colored.map((d, i) => (
          <div key={i} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: d.color }} />
              <span className="break-words">{d.label || "(sin etiqueta)"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// === Helpers para el dashboard CA ===
function groupSum(rows, key, valueName) {
  const acc = new Map();
  for (const r of rows) {
    const k = normStr(r[key]) || "(vacío)";
    const raw = (valueName ? r[valueName] : undefined);
    const v = parseNumberLoose(raw);
    acc.set(k, (acc.get(k) || 0) + (Number.isFinite(v) ? v : 0));
  }
  return [...acc.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter(d => Number.isFinite(d.value) && d.value > 0)
    .sort((a,b)=> b.value - a.value);
}
const topN = (arr, n=10) => arr.slice(0, n);

// Buscar variable por nombre aproximado (sin tilde)
function findVarByIncludes(criterios, needles=[]) {
  const norm = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  for (const c of (criterios||[])) {
    const n = norm(c.name||"");
    if (needles.some(nd => n.includes(nd))) return c.name;
  }
  return null;
}

// === Dashboard para CA ===
// === Dashboard para CA ===
function DashboardDataset({ dsName, rows, criterios }) {
  // ---- Clasificaciones segun "Tipo para individuales" ----
  const tipoInd = (criterios || []).filter(c => c.tipoInd);

  // Solo usar variables que EXISTEN para el dataset activo
  const hasVar = (c) => !!c.map?.[dsName];

  const resumenInd  = tipoInd.filter(c =>
    c.tipoInd.toLowerCase().includes("resumen") && hasVar(c)
  );
  const listasInd   = tipoInd.filter(c =>
    c.tipoInd === "Lista" && hasVar(c)
  );
  const graficables = tipoInd.filter(c =>
    /gr(a|á)fico/.test(c.tipoInd.toLowerCase()) && hasVar(c)
  );

  // MÉTRICAS desde criterios.xlsx (solo mapeadas y con total > 0)
  const metricDefsAll = tipoInd.filter(c =>
    c.tipoInd.toLowerCase() === "filtro metrica" && hasVar(c)
  );
  const metricDefs = metricDefsAll.filter(c => {
    const total = rows.reduce((a, r) => a + parseNumberLoose(r[c.name]), 0);
    return total > 0;
  });
  const metricOptions = metricDefs.map(c => c.name);

  // Estado de la métrica (después de tener metricOptions)
  const [metric, setMetric] = useState(metricOptions[0] || null);

  useEffect(() => {
    if (!metricOptions.includes(metric)) {
      setMetric(metricOptions[0] || null);
    }
  }, [dsName, criterios, metricOptions, metric]);

  // Variables de totales (pueden venir de tipoVersus o tipoInd como "Num suma")
  const isNumSuma = (c) => c.tipoVersus === "Num suma" || c.tipoInd === "Num suma";

  // Totales básicos (PIA/PIM/DEV/Girado)
  const totalDe = (k) => rows.reduce((a,r)=> a + parseNumberLoose(r[k]), 0);
  const tot = {
    PIA: totalDe("PIA"),
    PIM: totalDe("PIM"),
    DEV: totalDe("DEV"),
    Girado: totalDe("Girado")
  };
  const metricKey = metric || null; // null si no hay métricas definidas

  // ---------- RESUMEN ----------
  const formatResumenCelda = (c) => {
    const vals = rows.map(r => r[c.name]);
    const low = c.tipoInd.toLowerCase();
    if (low.includes("(rango)")) {
      return formatRangeDate(vals);
    }
    // por defecto: valores únicos
    return uniqueSorted(vals).join(" · ") || "—";
  };

  // ---------- LISTAS ----------
  const listasValores = (c) => uniqueSorted(rows.map(r => r[c.name]));

  return (
    <div className="space-y-4">
      {/* Resumen (parametrizado) */}
      {resumenInd.length > 0 && (
        <div className="card p-4">
          <div className="text-sm text-slate-600 mb-3">Resumen</div>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            {resumenInd.map((c) => (
              <div key={c.name}>
                <span className="text-slate-500">{c.name}:</span>{" "}
                <span className="font-medium">{formatResumenCelda(c)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Totales fijos */}
      {metricOptions.length > 0 && (
        <div className={`grid gap-4 ${metricOptions.length >= 4 ? "sm:grid-cols-4" : "sm:grid-cols-2"}`}>
          {metricOptions.map(m => {
            const total = rows.reduce((a,r)=> a + parseNumberLoose(r[m]), 0);
            return (
              <div key={m} className="card p-4">
                <div className="text-xs text-slate-500">{m} total</div>
                <div className="text-lg font-semibold">
                  {fmtMoney(total)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selector de métrica */}
      {(graficables.length > 0 && metricOptions.length > 0) && (
        <div className="card p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-600">Métrica:</span>
            <select className="input" value={metric || ""} onChange={(e)=>setMetric(e.target.value)}>
              {metricOptions.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Gráficos para TODAS las variables graficables existentes */}
      {graficables.map(g => {
        if (!metric) return null; // sin métrica válida, no graficar
        const metricKey = metric; // ya validado por metricOptions
        const grouped = groupSum(rows, g.name, metricKey);

        // si el total es 0, no tiene sentido graficar
        const total = grouped.reduce((a, b) => a + (Number.isFinite(b.value) ? b.value : 0), 0);
        if (!grouped.length || total <= 0) return null;

        const barsData = grouped
          .filter(d => Number.isFinite(d.value) && d.value > 0);

        if (!barsData.length) return null;

        return (
          <div key={g.name} className="grid md:grid-cols-2 gap-4">
            <div className="card p-4">
              <BarsChart data={barsData} title={`Gráfico de ${g.name} por ${metricKey}`} />
            </div>
            <div className="card p-4">
              <PieChart data={barsData} title={`Composición de ${g.name} por ${metricKey}`} />
            </div>
          </div>
        );
      })}

      {/* Listas (todas las que marque el Excel) */}
      {listasInd.length > 0 && (
        <div className="card p-4 space-y-4">
          <div className="text-sm text-slate-600">Listas</div>
          {listasInd.map((c) => {
            const items = listasValores(c).filter(v => normStr(v) !== "");
            return (
              <div key={c.name}>
                <div className="font-medium mb-1">{c.name}</div>
                <PagedList items={items} batch={15} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UploadCard({ label, accept, onFile, ds }) {
  const id = label.replace(/\s+/g, "_");
  const borderColor = DS_COLOR[ds] || "#E5E7EB";
  const bgSoft = DS_BG[ds] || "transparent";

  return (
    <div
      className="card p-4 space-y-3"
      style={{ borderColor, background: bgSoft }}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-700 font-medium">{label}</div>
        {ds && (
          <span
            className="px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: DS_COLOR[ds], color: "#fff" }}
          >
            {ds}
          </span>
        )}
      </div>

      <input
        id={id}
        type="file"
        accept={accept}
        onChange={(e) => onFile(e.target.files?.[0] || null)}
        className="input"
      />

      <div className="text-xs text-slate-600">
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
                    <a
                    className="link"
                    href="https://drive.google.com/file/d/1TQ4rjplKPUsD44dBS91O467S10__zthp/view?usp=sharing"
                    target="_blank"
                    rel="noopener noreferrer"
                    >scraper.exe</a>
              </li>
              <li>Ejecuta el archivo y sigue las instrucciones para elegir entidad y periodo.</li>
              <li>El programa exporta archivos <strong>CSV con encabezados</strong> para CEPLAN y CA.</li>
              <li>Vuelve a esta página y cárgalos en “Archivo CEPLAN (CSV)” y “Archivo CA (CSV)”.</li>
            </ol>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
            <a
            className="btn"
            href="https://drive.google.com/file/d/1TQ4rjplKPUsD44dBS91O467S10__zthp/view?usp=sharing"
            target="_blank"
            rel="noopener noreferrer"
            >Descargar scraper.exe</a>
        </div>
      </div>
    </div>
  );
}

function FilterModal({ open, onClose, varName, perDatasetValues, currentIncl, onApply }) {
  const dsList = ["CA","CEPLAN","SIGA"].filter(ds => (perDatasetValues?.[ds]?.length || 0) > 0);

  // Al abrir: si no hay selección previa -> marcar TODOS por defecto
  const buildInitial = () => {
    const o = {};
    for (const ds of dsList) {
      const cur = currentIncl?.[ds] || new Set();
      const allVals = (perDatasetValues?.[ds] || []).map(normStr);
      o[ds] = (cur.size === 0) ? new Set(allVals) : new Set([...cur].map(normStr));
    }
    return o;
  };

  const [local, setLocal] = useState(buildInitial);

  useEffect(() => {
    if (open) setLocal(buildInitial());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, varName, perDatasetValues, currentIncl]);

  if (!open) return null;

  const toggle = (ds, v) => {
    const key = normStr(v);
    setLocal(prev => {
      const copy = new Set(prev[ds] || []);
      if (copy.has(key)) copy.delete(key); else copy.add(key);
      return { ...prev, [ds]: copy };
    });
  };

  const bulk = (ds, type) => {
    const vals = (perDatasetValues?.[ds] || []).map(normStr);
    const next = (type === "all") ? new Set(vals) : new Set(); // "none" vacía => luego no filtra si decides no aplicar
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
                {(perDatasetValues?.[ds]||[]).map(v => {
                  const key = normStr(v);
                  const checked = local[ds]?.has(key) ?? true; // por defecto marcado
                  return (
                    <label key={ds+"|"+key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={()=>toggle(ds, v)}
                      />
                      <span className="break-words">{key || <i>(vacío)</i>}</span>
                    </label>
                  );
                })}
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
// Colores por dataset SOLO en app.js (sólido y sombreado translúcido)
const DS = {
  CA:     { solid: "#36A2EB", bg: "rgba(54,162,235,.12)" },
  CEPLAN: { solid: "#FF6384", bg: "rgba(255,99,132,.12)" },
  SIGA:   { solid: "#62c462", bg: "rgba(98,196,98,.12)" },
};

// Derivados para usar donde ya referenciabas DS_COLOR / DS_BG
const DS_COLOR = {
  CA: DS.CA.solid,
  CEPLAN: DS.CEPLAN.solid,
  SIGA: DS.SIGA.solid,
};
const DS_BG = {
  CA: DS.CA.bg,
  CEPLAN: DS.CEPLAN.bg,
  SIGA: DS.SIGA.bg,
};

// Sombreado de celdas (versus) con transparencia
const dsStyle = (ds) => ({ background: DS[ds]?.bg || "transparent" });

// Estilo de tab por dataset (inactivo = bg suave, activo = color sólido)
const dsTabStyle = (ds, active) => ({
  background: active ? DS[ds].solid : DS[ds].bg,
  color: active ? "#fff" : "#0f172a",
});



function VersusTable({ leftName, rightName, leftRows, rightRows, criterios }) {
  const resumenCriterios = criterios.filter(c =>
    c.tipoVersus?.toLowerCase().includes("para resumen") &&
    (c.map?.[leftName] || c.map?.[rightName])
  );
  const listas = criterios.filter(c =>
    c.tipoVersus === "Lista" &&
    (c.map?.[leftName] || c.map?.[rightName])
  );
  const nums = criterios.filter(c =>
    c.tipoVersus === "Num suma" &&
    (c.map?.[leftName] || c.map?.[rightName])
  );

  const countLeft = leftRows.length;
  const countRight = rightRows.length;

  // === Grilla de barras: una barra por variable "Num suma", en EL MISMO ORDEN que aparece en la tabla (sin ordenar por valor).
  const barsData = nums
    .map(c => {
      const leftHas = !!c.map?.[leftName];
      const rightHas = !!c.map?.[rightName];
      const sumLeft = leftRows.reduce((acc, r) => acc + parseNumberLoose(r[c.name]), 0);
      const sumRight = rightRows.reduce((acc, r) => acc + parseNumberLoose(r[c.name]), 0);

      let owner = leftName;
      if (leftHas && !rightHas) owner = leftName;
      else if (!leftHas && rightHas) owner = rightName;
      else if (leftHas && rightHas) owner = leftName;

      const value = owner === leftName ? sumLeft : sumRight;
      const color = DS[owner]?.solid || "#6B7280";
      return { label: c.name, value, color };
    })
    .filter(d => d.value > 0);

  const renderResumenItem = (c) => {
    const title = c.name;
    const t = (c.tipoVersus || "").toLowerCase();
    const isRango = t.includes("(rango)");
    const isUnicos = t.includes("(valores únicos)");
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
        <td className="py-2 px-3" style={dsStyle(leftName)}>
          <div style={{maxHeight:'260px', overflowY:'auto', wordBreak:'break-word', whiteSpace:'pre-wrap'}}>{leftVal}</div>
        </td>
        <td className="py-2 px-3" style={dsStyle(rightName)}>
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
        <td className="py-2 px-3" style={dsStyle(leftName)}>
          <PagedList items={L.map(normStr)} batch={3} />
        </td>
        <td className="py-2 px-3" style={dsStyle(rightName)}>
          <PagedList items={R.map(normStr)} batch={3} />
        </td>
      </tr>
    );
  };

  const renderNumRow = (c) => {
    const title = c.name;
    const sumLeft = leftRows.reduce((acc, r) => acc + parseNumberLoose(r[title]), 0);
    const sumRight = rightRows.reduce((acc, r) => acc + parseNumberLoose(r[title]), 0);
    return (
      <tr key={"num-"+title} className="border-t">
        <td className="py-2 pr-2 font-medium">{title}</td>
        <td className="py-2 px-3" style={dsStyle(leftName)}>{fmtMoney(sumLeft)}</td>
        <td className="py-2 px-3" style={dsStyle(rightName)}>{fmtMoney(sumRight)}</td>
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
                  <th className="py-2 px-3" style={dsStyle(leftName)}>{leftName}</th>
                  <th className="py-2 px-3" style={dsStyle(rightName)}>{rightName}</th>
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
                  <th className="py-2 px-3" style={dsStyle(leftName)}>{leftName}</th>
                  <th className="py-2 px-3" style={dsStyle(rightName)}>{rightName}</th>
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
          data={barsData} collapsePct={null}
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
  const [activeTab, setActiveTab] = useState("CA");
  const [filterVar, setFilterVar] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const sync = () => setRoute((location.hash || "#inicio").slice(1));
    window.addEventListener("hashchange", sync);
    sync();
    return () => window.removeEventListener("hashchange", sync);
  }, []);

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
      return;
    }
    try {
      const data = await readUserFile(file);
      setRaw(prev => ({ ...prev, [ds]: data }));

      if (criterios) {
        const normalized = normalizeDataset(data, ds, criterios);
        setNorm(prev => ({ ...prev, [ds]: normalized }));
      }
    } catch (e) {
      console.error(e);
      alert(`Error al leer ${ds}.`);
    }
  }

  useEffect(() => {
    if (!criterios) return;
    const nextNorm = { ...norm };
    for (const ds of ["CA","CEPLAN","SIGA"]) {
      const data = raw[ds];
      if (!data?.length) { nextNorm[ds]=[]; continue; }
      nextNorm[ds] = normalizeDataset(data, ds, criterios);
    }
    setNorm(nextNorm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criterios]);

  function computeStats(dsKey, rows, criterios) {
    if (!rows?.length) return { rows:0, nums:[] };
    const numCrits = (criterios || []).filter(c =>
      (c.tipoVersus === "Num suma" || c.tipoInd === "Num suma") && c.map?.[dsKey]
    );
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

  const stats = useMemo(() => {
    const make = (ds) => computeStats(ds, filtered[ds], criterios || []);
    return {
      CA: make("CA"),
      CEPLAN: make("CEPLAN"),
      SIGA: make("SIGA"),
    };
  }, [filtered, criterios]);


  const ready = !!criterios && (norm.CA.length || norm.CEPLAN.length || norm.SIGA.length);
  const canCompare = filtered.CA.length || filtered.CEPLAN.length || filtered.SIGA.length;

  const activeLeftRight = useMemo(() => {
    if (["CA","CEPLAN","SIGA"].includes(activeTab)) return null; // individuales
    if (activeTab === "CA_CEPLAN") return ["CA","CEPLAN"];
    if (activeTab === "CA_SIGA")   return ["CA","SIGA"];
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
            <UploadCard ds="CA" label="Archivo CA" accept=".csv,text/csv" onFile={(f)=>handleSelect('CA',f)} />
            <UploadCard ds="CEPLAN" label="Archivo CEPLAN" accept=".csv,text/csv" onFile={(f)=>handleSelect('CEPLAN',f)} />
            <UploadCard ds="SIGA" label="Archivo SIGA" accept=".txt,text/plain" onFile={(f)=>handleSelect('SIGA',f)} />
          </section>

{/* Filtros dinámicos (con icono y "Limpiar filtros" en la misma línea) */}
<div className="card p-4">
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2 text-sm text-slate-600">
      {/* Icono de filtro */}
      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6l-6.4 8.53V19a1 1 0 0 1-.553.894l-3 1.5A1 1 0 0 1 9 20.5v-5.37L2.2 5.6A1 1 0 0 1 3 5z"/>
      </svg>
      <span>Filtros (inclusión)</span>
    </div>
    <button
      className="btn-alt"
      onClick={() => { setInclusions({}); alert("Filtros limpiados."); }}
    >
      Limpiar filtros
    </button>
  </div>

  <div className="flex flex-wrap gap-2">
    {(criterios || []).filter(c => c.filtro && (c.map?.CA || c.map?.CEPLAN || c.map?.SIGA)).map(f => (
      <button
        key={f.name}
        className="btn"
        disabled={!ready}
        onClick={() => setFilterVar(f.name)}
        title="Incluir valores por dataset"
      >
        {/* pequeño icono en el botón */}
        <span className="inline-flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6l-6.4 8.53V19a1 1 0 0 1-.553.894l-3 1.5A1 1 0 0 1 9 20.5v-5.37L2.2 5.6A1 1 0 0 1 3 5z"/>
          </svg>
          Filtrar por {f.name}
        </span>
      </button>
    ))}
    {!(criterios || []).some(c => c.filtro) && (
      <div className="text-sm text-slate-400">No hay filtros definidos.</div>
    )}
  </div>
</div>

{/* Acción principal: Procesar comparación (centrado) */}
<div className="flex items-center justify-center">
  <button
    className="btn btn-navy"
    disabled={!ready || !canCompare}
    onClick={() => { location.hash = "resultados"; }}
  >
    Procesar comparación
  </button>
</div>

{/* Estadísticos descriptivos (antes estaba arriba como "Resumen rápido") */}
<div className="card p-4">
  <div className="text-sm text-slate-600 mb-3">Estadísticos descriptivos</div>
  <div className="grid sm:grid-cols-3 gap-4">
  {["CA","CEPLAN","SIGA"].map(ds => {
    const borderColor = DS_COLOR[ds];
    const bgSoft = DS_BG[ds];
    return (
      <div
        key={ds}
        className="border rounded-xl p-3"
        style={{ borderColor, background: bgSoft }}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="font-medium">{ds}</div>
          <span
            className="px-2 py-0.5 rounded-full text-xs font-semibold"
            style={{ background: DS_COLOR[ds], color: "#fff" }}
          >
            Resumen
          </span>
        </div>

        {!stats[ds] ? (
          <div className="text-xs text-slate-600">Sin datos</div>
        ) : (
          <>
            <div className="text-sm mb-2">
              Filas: <span className="font-semibold">{stats[ds].rows}</span>
            </div>
            <div className="space-y-1">
              {stats[ds].nums.map(n => (
                <div key={ds+"|"+n.name} className="text-xs">
                  <div className="font-medium">{n.name}</div>
                  <div>Suma: {fmtMoney(n.sum)}</div>
                  <div>Promedio: {fmtMoney(n.avg)}</div>
                </div>
              ))}
              {!stats[ds].nums.length && (
                <div className="text-xs text-slate-600">Sin variables numéricas</div>
              )}
            </div>
          </>
        )}
      </div>
    );
  })}
  </div>
</div>
        </>
      )}

      {/* ======= RESULTADOS ======= */}
      {route === "resultados" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {["CA","CEPLAN","SIGA"].map(ds => (
                <button
                  key={ds}
                  className="tab"
                  style={dsTabStyle(ds, activeTab === ds)}
                  onClick={()=>setActiveTab(ds)}
                >
                  {ds}
                </button>
              ))}

              <button className={`tab ${activeTab==="CA_CEPLAN" ? "tab-active" : ""}`} onClick={()=>setActiveTab("CA_CEPLAN")}>CA vs CEPLAN</button>
              <button className={`tab ${activeTab==="CA_SIGA" ? "tab-active" : ""}`} onClick={()=>setActiveTab("CA_SIGA")}>CA vs SIGA</button>
              <button className={`tab ${activeTab==="CEPLAN_SIGA" ? "tab-active" : ""}`} onClick={()=>setActiveTab("CEPLAN_SIGA")}>CEPLAN vs SIGA</button>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-alt" onClick={()=>setHelpOpen(true)}>Ayuda</button>
              <button className="btn-alt" onClick={()=>{ location.hash = "inicio"; }}>← Volver</button>
            </div>
          </div>

          {["CA","CEPLAN","SIGA"].includes(activeTab) ? (
            <DashboardDataset
              dsName={activeTab}
              rows={filtered[activeTab]}
              criterios={criterios || []}
            />
          ) : (
            <VersusTable
              leftName={activeLeftRight[0]}
              rightName={activeLeftRight[1]}
              leftRows={filtered[activeLeftRight[0]]}
              rightRows={filtered[activeLeftRight[1]]}
              criterios={criterios || []}
            />
          )}
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

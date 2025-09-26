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

// === Formato EN MILLONES (1 decimal) SOLO PARA GRÁFICOS ===
const toM   = (n) => (Number(n) || 0) / 1_000_000;
const fmtM1 = (n) => toM(n).toLocaleString('en-US', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

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

// ===== CONFIG: activar/desactivar el filtro automático de Subproducto =====
const AUTO_FILTER_SUBPRODUCTO = true;

// Limpieza específica para "Subproducto (AAO)" según dataset
function cleanSubproducto(ds, val) {
  const s = normStr(val);
  if (!s) return "";

  // CA y CEPLAN: recortar después de ": " si existe
  if (ds === "CA" || ds === "CEPLAN") {
    const parts = s.split(": ");
    return normStr(parts.length > 1 ? parts[1] : parts[0]);
  }

  // SIGA y cualquier otro dataset: devolver tal cual
  return s;
}

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


const fmtMoney = (n) =>
  "S/ " + new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    useGrouping: true
}).format(Number(n) || 0);


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

// Escapa separadores para construir el RegExp de split
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


function parseNumberFixed(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;

  let s = normStr(v)
    .replace(/\s+/g, "")                 // quita espacios
    .replace(/S\/|\$|USD|PEN/gi, "");    // limpia símbolos moneda (opcional)

  // negativos con paréntesis -> -n (opcional)
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);

  // SIEMPRE: coma = separador de miles -> elimínalas
  s = s.replace(/,/g, "");

  // deja solo dígitos, punto y signo menos
  s = s.replace(/[^0-9.-]/g, "");

  // si hubiera varios puntos, conserva SOLO el último como decimal
  const parts = s.split(".");
  if (parts.length > 2) {
    const last = parts.pop();
    s = parts.join("") + "." + last;
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
   ============================== 
*/

// Decodifica un Blob intentando UTF-8 y haciendo fallback a Windows-1252 y Latin-1
async function readBlobSmart(blob) {
  const ab = await blob.arrayBuffer();

  const decode = (label) => {
    try { return new TextDecoder(label).decode(ab); }
    catch { return null; }
  };

  // 1) Intento UTF-8
  let text = decode("utf-8");
  if (text != null && !/[ÃÂ�]/.test(text)) return text;

  // 2) Fallback Windows-1252
  const w = decode("windows-1252");
  if (w != null && !/[ÃÂ�]/.test(w)) return w;

  // 3) Último intento Latin-1
  const l = decode("latin1");
  if (l != null) return l;

  // Si todo falla, retorna lo que haya de UTF-8
  return text ?? "";
}


function parseCSVFile(file, opts = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const text = await readBlobSmart(file); // ← ahora autodetecta
      Papa.parse(text, {
        header: true,
        skipEmptyLines: "greedy",
        delimiter: opts.delimiter || "",
        transformHeader: (h) => normStr(h),
        complete: (res) => resolve(res.data),
        error: (err) => reject(err)
      });
    } catch (e) {
      reject(e);
    }
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
  // Mapa auxiliar: header en minúsculas -> header original (para acceder al row con la clave real)
  const headerMap = {};
  Object.keys(rows[0] || {}).forEach(h => { headerMap[h.toLowerCase()] = h; });

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

    // ---- NUEVO: soportar expresiones tipo var(("sep1","sep2"), start, count) ----
    // Ej.: clasificador((","," "),1,2)
    criterios.forEach(c => {
      const spec = c.map?.[datasetKey];
      if (!spec) return;

      // patrón: nombreCol ( ( "sep1","sep2",... ), start, count )
      const rx = /^([a-zA-Z0-9_]+)\s*\(\s*\(\s*([^)]*?)\s*\)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/;
      const m = spec.match(rx);
      if (!m) return;

      const colName = m[1].trim();
      const sepsRaw = m[2];                // contenido entre los paréntesis dobles
      const start   = parseInt(m[3], 10);  // 1-based
      const count   = parseInt(m[4], 10);

      // Normaliza lista de separadores: admite comillas simples o dobles
      const seps = (sepsRaw.match(/(["'])(.*?)\1/g) || [])
        .map(s => s.slice(1, -1))          // quita comillas
        .filter(s => s.length > 0);

      // Obtiene la columna real (case-insensitive)
      const realKey = headerMap[colName.toLowerCase()] || colName;
      const raw = r[realKey];
      if (raw == null) { out[c.name] = ""; return; }

      // Split por cualquiera de los separadores, quitar vacíos y trim
      const splitter = seps.length
        ? new RegExp(seps.map(escapeRegExp).join("|"), "g")
        : /[, ]/g; // fallback: coma o espacio si no vinieran separadores

      const tokens = String(raw)
        .split(splitter)
        .map(t => t.trim())
        .filter(t => t !== "");

      // Tomar tramo (1-based) y concatenar si count>1
      const i0 = Math.max(0, start - 1);
      const slice = tokens.slice(i0, i0 + count);

      if (slice.length === 0) {
        out[c.name] = "";
      } else if (slice.length === 1) {
        out[c.name] = slice[0];
      } else {
        out[c.name] = slice.join(" - ");
      }
    });


    // ---- NUEVO: soportar mapeos compuestos "a - b - c" definidos en criterios.xlsx ----
    criterios.forEach(c => {
      const srcSpec = c.map?.[datasetKey];
      if (!srcSpec) return;

      // ¿Es compuesto? (separa por "-")
      if (srcSpec.includes("-")) {
        const parts = srcSpec.split("-").map(s => s.trim()).filter(Boolean);

        // Obtiene el valor de cada parte con resolución case-insensitive
        const partVals = parts.map(p => {
          const keyLow = p.toLowerCase();
          const realKey = headerMap[keyLow] || p; // cae al nombre tal cual si no está en el mapa
          const v = r[realKey];
          return (v == null) ? "" : String(v).trim();
        });

        // Concatena usando " - " SOLO con las partes no vacías
        const joined = partVals.filter(x => x !== "").join(" - ");

        // Escribe la variable normalizada con el nombre destino (c.name)
        // Nota: si no hay ninguna parte con valor, deja vacío ("") para no romper tipos
        out[c.name] = joined;
      }
    });

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
function BarsChart({
  data,
  title,
  maxWidth = 350,
  collapsePct = 0.06,
  showLegend = true,
  showBarLabels = false
}) {

  const base = (collapsePct == null)
    ? (data || [])
    : collapseSmall(data, collapsePct, OTHERS_LABEL);

  // Fuerza “Otros” en gris ANTES de la paleta
  const enforced = base.map(d => {
    const isOtros = normStr(d.label).toLowerCase() === OTHERS_LABEL.toLowerCase();
    return isOtros ? { ...d, color: OTHERS_COLOR } : d;
  });

  // La paleta respeta color preasignado 
  const prepared = withPalette(enforced); 

  if (!prepared.length) {
    return (
      <div className="space-y-3 text-slate-700">
        {title && <div className="font-medium">{title}</div>}
        <div className="text-sm text-slate-500">No hay variables con suma &gt; 0.</div>
      </div>
    );
  }

  const maxVal = Math.max(1, ...prepared.map(d => d.value));
const fmtAxis = (v) => fmtM1(v); // ticks en millones (1 decimal)

  const marks = niceTicks(maxVal, 5);
  const yMax = marks[marks.length - 1] || maxVal;

  // Márgenes y altura dinámicos: banda para labels bajo el eje
  const widestTick = marks.map(fmtAxis).reduce((a, b) => (a.length > b.length ? a : b), "");

  // Altura extra para etiquetas de 2 líneas (10px font + 11px de línea + holgura)
  const lineH = 11;                    // debe coincidir con el dy de <tspan>
  const maxLabelLines = showLegend ? 2 : 3;
  const baseBelowAxis = 20;            // aire bajo la primera línea
  const extraBottom = showBarLabels ? ((maxLabelLines - 1) * lineH + baseBelowAxis) : 0;

  const pad = {
    top: 36,
    right: 24,
    bottom: 32 + extraBottom,
    left: Math.max(56, 10 + widestTick.length * 8)
  };

  const width  = Math.min(maxWidth, Math.max(360, prepared.length * 90 + pad.left + pad.right));
  const BASE_PLOT_H = 220; // altura del área de barras (sin labels)
  const height = pad.top + BASE_PLOT_H + pad.bottom; // altura total ADAPTATIVA
  const innerW = width - pad.left - pad.right;
  const innerH = BASE_PLOT_H; // altura del área de barras fija
  const xStep  = innerW / prepared.length;
  const barW   = Math.min(52, xStep * 0.6);


  // Envoltura en 2/3 líneas máximo (3 cuando NO hay leyenda), sensible al ancho real de la barra.
  // Aprox: ~6px por carácter a font 10 => barW/6 chars por línea (con mínimos).
  const wrapLabel = (txt) => {
    const text = (txt ?? "").toString().trim();
    const perLine = Math.max(8, Math.floor(barW / 6)); // 8 como piso
    const maxLines = showLegend ? 2 : 3;               // ← 3 líneas si NO hay leyenda

    // Si es una sola "palabra" muy larga, cortamos por segmentos
    const chunkWord = (s, n) => s.match(new RegExp(`.{1,${n}}`, "g")) || [s];

    const words = text.split(/\s+/).flatMap(w => {
      return w.length > perLine ? chunkWord(w, perLine) : [w];
    });

    const lines = [];
    let cur = "";
    for (const w of words) {
      const candidate = (cur ? cur + " " : "") + w;
      if (candidate.length <= perLine) {
        cur = candidate;
      } else {
        if (cur) lines.push(cur);
        cur = w;
        if (lines.length >= maxLines - 1) break; // dejamos el resto para la última línea
      }
    }
    if (cur && lines.length < maxLines) lines.push(cur);

    // Si quedaron palabras fuera, no añadimos más líneas (sin "…" para no ensuciar)
    return lines.slice(0, maxLines);
  };

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
        
        <text
          x={width - pad.right}
          y={pad.top - 10}
          textAnchor="end"
          fontSize="11"
          fill="currentColor"
          opacity="0.6"
        >
          millones
        </text>


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

            return (
              <g key={d.label}>
                <rect x={x} y={y} width={barW} height={h} rx="8" fill={d.color || "currentColor"} opacity="0.85" />
                <text x={x + barW / 2} y={valueY} textAnchor="middle" fontSize="12">{fmtM1(d.value)}</text>

                {/* Etiqueta bajo la barra (solo en versus) */}
                {showBarLabels && (
                  <text
                    x={x + barW / 2}
                    y={height - pad.bottom + 10}  // más arriba para dejar aire abajo
                    textAnchor="middle"
                    fontSize="10"                 // más compacto
                  >
                    {wrapLabel(d.label).map((line, li) => (
                      <tspan key={li} x={x + barW / 2} dy={li === 0 ? 0 : 11}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Leyenda (solo si se solicita) */}
        {showLegend && (
          <div className="mt-3 space-y-1">
          {prepared.map((d,i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: d.color }} />
              <span className="break-words">{d.label}</span>
            </div>
          ))}
          </div>
        )}

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
  const toXY = (ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];

  // Si hay un solo valor, dibuja un círculo completo con la etiqueta centrada
  if (colored.length === 1) {
    const d = colored[0];
    const valTxt = fmtM1(d.value);
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

          <text
            x={size - 8}
            y={14}
            textAnchor="end"
            fontSize="11"
            fill="currentColor"
            opacity="0.6"
          >
            millones
          </text>

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

        <text
          x={size - 8}
          y={14}
          textAnchor="end"
          fontSize="11"
          fill="currentColor"
          opacity="0.6"
        >
          millones
        </text>

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
            const valTxt = fmtM1(d.value);
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
    const v = parseNumberFixed(raw);
    acc.set(k, (acc.get(k) || 0) + (Number.isFinite(v) ? v : 0));
  }
  return [...acc.entries()]
    .map(([label, value]) => ({ label, value }))
    .filter(d => Number.isFinite(d.value) && d.value > 0)
    .sort((a,b)=> b.value - a.value);
}


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
    const total = rows.reduce((a, r) => a + parseNumberFixed(r[c.name]), 0);
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
  const totalDe = (k) => rows.reduce((a,r)=> a + parseNumberFixed(r[k]), 0);
  const tot = {
    PIA: totalDe("PIA"),
    PIM: totalDe("PIM"),
    DEV: totalDe("DEV"),
    Girado: totalDe("Girado")
  };

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
            const total = rows.reduce((a,r)=> a + parseNumberFixed(r[m]), 0);
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
                    href="https://drive.google.com/file/d/1m9zGHSTOg1mvc54K4oiX6a73O4Yg0CgP/view?usp=drive_link"
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
            href="https://https://drive.google.com/file/d/1m9zGHSTOg1mvc54K4oiX6a73O4Yg0CgP/view?usp=drive_link"
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

  // arriba del componente puedes declarar (opcional) para no repetir el string:
  const SUBPRODUCTO_VAR = "Subproducto (AAO)";

  const buildInitial = () => {
    const o = {};
    for (const ds of dsList) {
      const cur = currentIncl?.[ds] || new Set();
      const allVals = (perDatasetValues?.[ds] || []).map(normStr);

      // Para TODOS los filtros (incluido Subproducto), si no hay selección previa: marcar TODO.
      o[ds] = (cur.size === 0)
        ? new Set(allVals)
        : new Set([...cur].map(normStr));
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

const isEmptyLabel = (s) => {
  const t = normStr(s);
  return !t || t.toLowerCase() === "(vacío)";
};


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

  // ===== Filtros de métrica por COLUMNA =====
  const metricCandidatesAll = (criterios || []).filter(c =>
    (c.tipoInd || "").toLowerCase() === "filtro metrica" &&
    (c.map?.[leftName] || c.map?.[rightName])
  );

  // Opciones por columna (sólo si existen en ese dataset y el total > 0 EN ESA COLUMNA)
  const metricOptionsLeft = metricCandidatesAll
    .filter(c => c.map?.[leftName])
    .filter(c => leftRows.reduce((a, r) => a + parseNumberFixed(r[c.name]), 0) > 0)
    .map(c => c.name);

  const metricOptionsRight = metricCandidatesAll
    .filter(c => c.map?.[rightName])
    .filter(c => rightRows.reduce((a, r) => a + parseNumberFixed(r[c.name]), 0) > 0)
    .map(c => c.name);

  // Estado independiente por columna
  const [metricLeft, setMetricLeft]   = React.useState(metricOptionsLeft[0]  || null);
  const [metricRight, setMetricRight] = React.useState(metricOptionsRight[0] || null);

  // Si cambian datasets u opciones, re-asegura que el valor sea válido
  React.useEffect(() => {
    if (!metricOptionsLeft.includes(metricLeft)) {
      setMetricLeft(metricOptionsLeft[0] || null);
    }
    if (!metricOptionsRight.includes(metricRight)) {
      setMetricRight(metricOptionsRight[0] || null);
    }
  }, [leftName, rightName, criterios, leftRows, rightRows, metricOptionsLeft, metricOptionsRight]); 


  const countLeft = leftRows.length;
  const countRight = rightRows.length;

  // === Grilla de barras: una barra por variable "Num suma", en EL MISMO ORDEN que aparece en la tabla (sin ordenar por valor).
  const barsData = nums
    .map(c => {
      const leftHas = !!c.map?.[leftName];
      const rightHas = !!c.map?.[rightName];
      const sumLeft = leftRows.reduce((acc, r) => acc + parseNumberFixed(r[c.name]), 0);
      const sumRight = rightRows.reduce((acc, r) => acc + parseNumberFixed(r[c.name]), 0);

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

  // Badge de monto SOLO para la segunda tabla de versus
  const amountBoxStyle = {
    display: "inline-block",
    padding: "2px 6px",
    background: "#ffffffff",      // slate-100-ish
    border: "1px solid #E2E8F0",// slate-200-ish
    borderRadius: "6px",
    fontSize: "12px",
    fontWeight: 600,
    lineHeight: 1
  };
  const Amount = ({ n }) => {
    const v = Number(n) || 0;
    return v > 0 ? <span style={amountBoxStyle}>{fmtMoney(v)}</span> : null;
  };

  const renderListaRow = (c) => {
    const title = c.name;

    // Fallback si alguna columna no tiene métrica válida
    const noLeft  = !metricLeft;
    const noRight = !metricRight;

    if (noLeft || noRight) {
      const L = uniqueSorted(leftRows.map(r => r[title]));
      const R = uniqueSorted(rightRows.map(r => r[title]));
      return (
        <tr key={"lista-"+title} className="align-top border-t">
          <td className="py-2 pr-2 font-medium">{title}</td>
          <td className="py-2 px-3" style={dsStyle(leftName)}>
            {noLeft ? (
              <>
                <div className="text-xs text-slate-500">Seleccione una métrica para {leftName}</div>
                <PagedList items={L.map(normStr)} batch={3} />
              </>
            ) : (
              <PagedList
                items={groupSum(leftRows, title, metricLeft)
                  .filter(d => !isEmptyLabel(d.label)) // ← también descarta "(vacío)"
                  .map((d, i) => (
                    <span key={"L-fallback-"+title+"-"+i}>
                      {normStr(d.label)} <Amount n={d.value} />
                    </span>
                  ))}
                batch={3}
              />
            )}
          </td>
          <td className="py-2 px-3" style={dsStyle(rightName)}>
            {noRight ? (
              <>
                <div className="text-xs text-slate-500">Seleccione una métrica para {rightName}</div>
                <PagedList items={R.map(normStr)} batch={3} />
              </>
            ) : (
              <PagedList
                items={groupSum(rightRows, title, metricRight)
                  .filter(d => !isEmptyLabel(d.label)) // ← también descarta "(vacío)"
                  .map((d, i) => (
                    <span key={"R-fallback-"+title+"-"+i}>
                      {normStr(d.label)} <Amount n={d.value} />
                    </span>
                  ))}
                batch={3}
              />
            )}
          </td>
        </tr>
      );
    }

    // Caso normal: ambas columnas con métrica activa
    const Lg = groupSum(leftRows,  title, metricLeft)
      .filter(d => !isEmptyLabel(d.label)); // ← excluye "" y "(vacío)"
    const Rg = groupSum(rightRows, title, metricRight)
      .filter(d => !isEmptyLabel(d.label)); // ← excluye "" y "(vacío)"

    const Litems = Lg.map((d, i) => (
      <span key={"L-"+title+"-"+i}>
        {normStr(d.label) ? (
          <>
            {normStr(d.label)} <Amount n={d.value} />
          </>
        ) : null}
      </span>
    ));
    const Ritems = Rg.map((d, i) => (
      <span key={"R-"+title+"-"+i}>
        {normStr(d.label) ? (
          <>
            {normStr(d.label)} <Amount n={d.value} />
          </>
        ) : null}
      </span>
    ));

    return (
      <tr key={"lista-"+title} className="align-top border-t">
        <td className="py-2 pr-2 font-medium">{title}</td>
        <td className="py-2 px-3" style={dsStyle(leftName)}>
          <PagedList items={Litems} batch={3} />
        </td>
        <td className="py-2 px-3" style={dsStyle(rightName)}>
          <PagedList items={Ritems} batch={3} />
        </td>
      </tr>
    );
  };

  const renderNumRow = (c) => {
    const title = c.name;
    const sumLeft = leftRows.reduce((acc, r) => acc + parseNumberFixed(r[title]), 0);
    const sumRight = rightRows.reduce((acc, r) => acc + parseNumberFixed(r[title]), 0);
    return (
      <tr key={"num-"+title} className="border-t">
        <td className="py-2 pr-2 font-medium">{title}</td>
        <td className="py-2 px-3" style={dsStyle(leftName)}>
          {sumLeft > 0 && <Amount n={sumLeft} />}
        </td>
        <td className="py-2 px-3" style={dsStyle(rightName)}>
          {sumRight > 0 && <Amount n={sumRight} />}
        </td>
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
          {/* Encabezado: select por columna */}
          {(metricOptionsLeft.length > 0 || metricOptionsRight.length > 0) && (
            <div className="grid grid-cols-3 items-center mb-2 gap-2">
              <div className="text-sm text-slate-600">Filtro métrica:</div>

              <div className="flex items-center gap-2 justify-start">
                <span className="text-xs text-slate-500">{leftName}</span>
                <select
                  className="input"
                  value={metricLeft || ""}
                  onChange={(e)=>setMetricLeft(e.target.value)}
                  disabled={metricOptionsLeft.length === 0}
                >
                  {metricOptionsLeft.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div className="flex items-center gap-2 justify-start">
                <span className="text-xs text-slate-500">{rightName}</span>
                <select
                  className="input"
                  value={metricRight || ""}
                  onChange={(e)=>setMetricRight(e.target.value)}
                  disabled={metricOptionsRight.length === 0}
                >
                  {metricOptionsRight.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}

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
          data={barsData}
          collapsePct={null}
          showLegend={false}
          showBarLabels={true}
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

  // Para aplicar el auto-filtro una sola vez por ciclo de carga
  const [inclusions, setInclusions] = useState({});

  const [autoSubprodApplied, setAutoSubprodApplied] = useState(false);

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
        setAutoSubprodApplied(false);
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

  // Auto-filtro para "Subproducto (AAO)" (aplica checks y ordena listas)
  useEffect(() => {
    if (!AUTO_FILTER_SUBPRODUCTO) return;
    if (!criterios) return;
    if (autoSubprodApplied) return;

    const varName = "Subproducto (AAO)";
    const hasVar =
      criterios.some(c => c.name === varName && (c.map?.CA || c.map?.CEPLAN || c.map?.SIGA));
    if (!hasVar) return;

    // Deben existir los TRES datasets con filas
    if (!(norm.CA.length && norm.CEPLAN.length && norm.SIGA.length)) return;

    // Construye: dataset -> Map(clean -> Set de originales) para evitar duplicados
    const seenOrderCA = [];
    const seenCA = new Set();
    const maps = { CA: new Map(), CEPLAN: new Map(), SIGA: new Map() };

    const ingest = (ds, rows) => {
      for (const r of rows) {
        const original = normStr(r[varName]);
        if (original === "") continue;
        const cleaned = cleanSubproducto(ds, original);
        if (!maps[ds].has(cleaned)) maps[ds].set(cleaned, new Set());
        maps[ds].get(cleaned).add(original);

        if (ds === "CA" && !seenCA.has(cleaned)) {
          seenCA.add(cleaned);
          seenOrderCA.push(cleaned); // orden de CA
        }
      }
    };

    ingest("CA", norm.CA);
    ingest("CEPLAN", norm.CEPLAN);
    ingest("SIGA", norm.SIGA);

    // Intersección exacta (presentes en los tres)
    const keysCA = new Set(maps.CA.keys());
    const keysCE = new Set(maps.CEPLAN.keys());
    const keysSI = new Set(maps.SIGA.keys());
    const isInAll = (k) => keysCA.has(k) && keysCE.has(k) && keysSI.has(k);

    const intersection = new Set([...keysCA].filter(isInAll));
    if (intersection.size === 0) {
      setAutoSubprodApplied(true);
      return;
    }

    // Selecciones por dataset: todos los "originales" cuyo cleaned ∈ intersección
    const sel = { CA: new Set(), CEPLAN: new Set(), SIGA: new Set() };
    for (const ds of ["CA","CEPLAN","SIGA"]) {
    for (const [cleaned, originalsSet] of maps[ds].entries()) {
      if (!intersection.has(cleaned)) continue;
      for (const o of originalsSet) sel[ds].add(normStr(o)); // marca TODOS los originales que caen en ese "clean"
      }
    }

    // Establece inclusions iniciales sólo si no había selección previa del usuario
    setInclusions(prev => {
      const already = prev?.[varName];
      if (already && (already.CA?.size || already.CEPLAN?.size || already.SIGA?.size)) {
        return prev; // respeta selección manual existente
      }
      return {
        ...prev,
        [varName]: {
          CA: sel.CA,
          CEPLAN: sel.CEPLAN, 
          SIGA: sel.SIGA
        }
      };
    });

    setAutoSubprodApplied(true);
  }, [AUTO_FILTER_SUBPRODUCTO, norm, criterios, autoSubprodApplied]);


  function computeStats(dsKey, rows, criterios) {
    if (!rows?.length) return { rows:0, nums:[] };
    const numCrits = (criterios || []).filter(c =>
      (c.tipoVersus === "Num suma" || c.tipoInd === "Num suma") && c.map?.[dsKey]
    );
    const nums = numCrits.map(c => {
      const arr = rows.map(r => r[c.name]);
      const valid = arr.map(parseNumberFixed).filter(n => Number.isFinite(n));
      const sum = valid.reduce((a,b)=>a+b,0);
      const avg = valid.length ? sum/valid.length : 0;
      return { name:c.name, sum, avg };
    });
    return { rows: rows.length, nums };
  }

  const perVarValues = useMemo(() => {
    if (!criterios) return {};
    const out = {};

    // Helper para ordenar por:
    // 1) checks primero (según inclusions[varName][ds])
    // 2) orden de CA por "cleaned"
    // 3) resto al final en el mismo orden de llegada
    const orderForSubproducto = (varName, ds) => {
      // Mapea "clean" -> Set de originales (para deduplicar)
      const buildMap = (rows, dataset) => {
        const m = new Map();
        for (const r of rows) {
          const orig = normStr(r[varName]);
          if (!orig) continue;
          const cl = cleanSubproducto(dataset, orig);
          if (!m.has(cl)) m.set(cl, new Set());
          m.get(cl).add(orig); // ← Set evita repetir originales
        }
        return m;
      };

      const mapCA = buildMap(norm.CA, "CA");
      const mapDS = buildMap(norm[ds], ds);

      // Orden base: el orden de las claves "clean" vistas en CA
      const caOrder = [...mapCA.keys()];

      // Conjunto de seleccionados actuales (para ordenar seleccionados primero)
      const selSet = inclusions?.[varName]?.[ds] || new Set();

      const selected = [];
      const notSelected = [];

      // Helper para empujar únicos preservando orden
      const pushList = (arr, values) => {
        for (const v of values) arr.push(v);
      };

      // 1) Claves que existen en CA (en el orden de CA)
      for (const cl of caOrder) {
        const originals = mapDS.get(cl) ? [...mapDS.get(cl)] : [];
        const sel = originals.filter(o => selSet.has(normStr(o)));
        const rest = originals.filter(o => !selSet.has(normStr(o)));
        pushList(selected, sel);
        pushList(notSelected, rest);
      }

      // 2) Claves que están en DS pero no en CA (van al final)
      for (const [cl, originalsSet] of mapDS.entries()) {
        if (caOrder.includes(cl)) continue;
        const originals = [...originalsSet];
        const sel = originals.filter(o => selSet.has(normStr(o)));
        const rest = originals.filter(o => !selSet.has(normStr(o)));
        pushList(selected, sel);
        pushList(notSelected, rest);
      }

      // 3) Deduplicar preservando orden (por si un mismo "original" salió en varias filas)
      const seen = new Set();
      const out = [];
      for (const v of [...selected, ...notSelected]) {
        const k = normStr(v);
        if (!seen.has(k)) { seen.add(k); out.push(v); }
      }
      return out;
    };

    for (const c of filtroVars) {
      if (c.name === "Subproducto (AAO)" && AUTO_FILTER_SUBPRODUCTO) {
        out[c.name] = {
          CA: c.map?.CA ? orderForSubproducto(c.name, "CA") : [],
          CEPLAN: c.map?.CEPLAN ? orderForSubproducto(c.name, "CEPLAN") : [],
          SIGA: c.map?.SIGA ? orderForSubproducto(c.name, "SIGA") : [],
        };
      } else {
        out[c.name] = {
          CA: c.map?.CA ? uniqueSorted(norm.CA.map(r => r[c.name])) : [],
          CEPLAN: c.map?.CEPLAN ? uniqueSorted(norm.CEPLAN.map(r => r[c.name])) : [],
          SIGA: c.map?.SIGA ? uniqueSorted(norm.SIGA.map(r => r[c.name])) : [],
        };
      }
    }
    return out;
  }, [norm, criterios, filtroVars, inclusions]);

  // Inclusiones aplicadas por dataset
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
        perDatasetValues={filterVar ? (perVarValues[filterVar] || {}) : {}}
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

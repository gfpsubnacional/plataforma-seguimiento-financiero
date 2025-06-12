// Limpiar almacenamiento al recargar o cerrar
window.addEventListener('beforeunload', () => {
    localStorage.clear();
    sessionStorage.clear();
});

window.archivosCSV = {};

// Manejo de carga de archivos
document.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (event) => {
        const file = event.target.files[0];
        const inputId = input.id;
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const arrayBuffer = e.target.result;
                const uint8Array = new Uint8Array(arrayBuffer);

                // Detectar codificación con jschardet
                const detected = jschardet.detect(uint8Array);
                let encoding = detected.encoding ? detected.encoding.toLowerCase() : 'utf-8';

                // Reasignar codificaciones similares a una versión compatible
                if (encoding === 'iso-8859-1') {
                    encoding = 'windows-1252';
                }

                // Fallback si no es reconocida
                if (!['utf-8', 'windows-1252', 'iso-8859-1'].includes(encoding)) {
                    encoding = 'utf-8';
                }

                console.log(`Codificación usada para ${file.name}: ${encoding}`);

                let csvData;
                try {
                    csvData = new TextDecoder("utf-8", { fatal: true }).decode(uint8Array);
                    console.log("Decodificado correctamente como UTF-8");
                } catch {
                    csvData = new TextDecoder("windows-1252", { fatal: false }).decode(uint8Array);
                    console.log("Decodificado como fallback: Windows-1252");
                }

                const isTxt = file.name.toLowerCase().endsWith('.txt');
                console.log(`Contenido del archivo ${file.name}:\n`, csvData.slice(0, 300));

                Papa.parse(csvData, {
                    header: true,
                    dynamicTyping: true,
                    delimiter: isTxt ? '\t' : '',
                    complete: (results) => {
                        const data = results.data.filter(row =>
                            Object.values(row).some(val => val !== null && val !== '')
                        );

                        if (data.length === 0) {
                            alert(`El archivo "${file.name}" no contiene datos válidos.`);
                            return;
                        }

                        window.archivosCSV[inputId] = data;
                        console.log(`Archivo cargado (${inputId}):`, data);
                    }
                });
            };
            reader.readAsArrayBuffer(file);
        }
    });
});

// Mostrar popups de ayuda
document.querySelectorAll('[data-popup]').forEach(button => {
    button.addEventListener('click', () => {
        const src = button.getAttribute('data-popup');
        const popup = document.getElementById('popup');
        const iframe = document.getElementById('popup-iframe');
        iframe.src = src;
        popup.classList.remove('hidden');
    });
});

// Cerrar el popup
document.getElementById('popup-close').addEventListener('click', () => {
    document.getElementById('popup').classList.add('hidden');
    document.getElementById('popup-iframe').src = '';
});

const normalizacionColumnas = {
    'AÑO_EJECUCION': 'ano_eje',
    'EJECUTORA_SECTOR': 'sector',
    'EJECUTORA_PLIEGO': 'pliego',
    'CATEGORIA_PRESUPUESTAL': 'categoria_pptal',
    'EJECUTORA_NOMBRE': 'ejecutora',
    'PRODUCTO_NOMBRE': 'prod_proy',
    'SUB_GENERICA': 'subgenerica',
    'CENTRO_COSTO_NOMBRE': 'c_costo',
    'GENERICA': 'generica'
};

const normalizarClaves = (data) => {
    return data.map(obj => {
        const nuevo = {};
        for (const key in obj) {
            const claveNormalizada = normalizacionColumnas[key] || key;
            nuevo[claveNormalizada] = obj[key];
        }
        return nuevo;
    });
};

document.getElementById('process-btn').addEventListener('click', () => {
    const caRaw = window.archivosCSV['ca'];
    const ceplanRaw = window.archivosCSV['ceplan'];
    const sigaRaw = window.archivosCSV['siga'];

    const faltan = [];
    if (!caRaw) faltan.push('CA');
    if (!ceplanRaw) faltan.push('CEPLAN');
    if (!sigaRaw) faltan.push('SIGA');

    if (faltan.length) {
        alert('Faltan los siguientes archivos: ' + faltan.join(', '));
        return;
    }

    const caJson = normalizarClaves(caRaw);
    const ceplanJson = normalizarClaves(ceplanRaw);
    const sigaJson = normalizarClaves(sigaRaw);

    const columnasNumericas = [
        'DEV', 'PIA', 'PIM', 'Girado',
        'POI_aprobado', 'POI_consistente_PIA', 'POI modificado',
        'ITEM_IMPORTE'
    ];

    const limpiarNumericos = (data, columnas) => {
        return data.map(obj => {
            const copia = { ...obj };
            columnas.forEach(col => {
                if (col in copia && typeof copia[col] === 'string') {
                    const limpio = copia[col].replace(/,/g, '').trim();
                    const valorNum = parseFloat(limpio);
                    copia[col] = isNaN(valorNum) ? 0 : valorNum;
                }
            });
            return copia;
        });
    };

    const caNum = limpiarNumericos(caJson, columnasNumericas);
    const ceplanNum = limpiarNumericos(ceplanJson, columnasNumericas);
    const sigaNum = limpiarNumericos(sigaJson, columnasNumericas);

    const comparaciones = [];

    const construirComparacion = (data1, data2, data1Num, data2Num, nombre1, nombre2, listar, sumar) => {
        const obtenerUnicos = (data, col) => [...new Set(data.map(x => x[col]).filter(Boolean))].sort().join(', ');
        const sumarColumna = (data, col) => Math.round(data.reduce((acc, x) => acc + (parseFloat(x[col]) || 0), 0) * 100) / 100;

        const filas = [];

        listar.forEach(col => filas.push([col, obtenerUnicos(data1, col), obtenerUnicos(data2, col)]));
        sumar.forEach(col => filas.push([`Suma ${col}`, sumarColumna(data1Num, col), sumarColumna(data2Num, col)]));

        comparaciones.push({ titulo: `${nombre1} vs ${nombre2}`, nombre1, nombre2, filas });
    };

    construirComparacion(caJson, ceplanJson, caNum, ceplanNum, 'CA', 'CEPLAN',
        ['sector', 'pliego', 'ejecutora', 'categoria_pptal', 'prod_proy', 'c_costo'],
        ['DEV', 'PIA', 'PIM', 'Girado', 'POI_aprobado', 'POI_consistente_PIA', 'POI modificado']);

    construirComparacion(caJson, sigaJson, caNum, sigaNum, 'CA', 'SIGA',
        ['sector', 'pliego', 'ejecutora', 'categoria_pptal', 'prod_proy', 'c_costo', 'generica', 'subgenerica'],
        ['DEV', 'PIA', 'PIM', 'Girado', 'ITEM_IMPORTE']);

    construirComparacion(ceplanJson, sigaJson, ceplanNum, sigaNum, 'CEPLAN', 'SIGA',
        ['sector', 'pliego', 'ejecutora', 'categoria_pptal', 'prod_proy', 'c_costo', 'generica', 'subgenerica'],
        ['ITEM_IMPORTE', 'POI_aprobado', 'POI_consistente_PIA', 'POI modificado']);

    mostrarResultadosVisuales(comparaciones);
});

// === Mostrar resultados en la web ===
const mostrarResultadosVisuales = (comparaciones) => {
    const container = document.getElementById("resultados-container");
    container.innerHTML = '';

    const tabHeader = document.createElement("div");
    tabHeader.className = "tabs";
    const tabContent = document.createElement("div");
    tabContent.className = "tab-content";

    comparaciones.forEach((comp, i) => {
        const tabBtn = document.createElement("button");
        tabBtn.textContent = comp.titulo;
        tabBtn.className = i === 0 ? 'active' : '';
        tabBtn.onclick = () => {
            document.querySelectorAll('.tabs button').forEach(btn => btn.classList.remove('active'));
            tabBtn.classList.add('active');
            mostrarTab(comp, tabContent);
        };
        tabHeader.appendChild(tabBtn);
    });

    container.appendChild(tabHeader);
    container.appendChild(tabContent);
    mostrarTab(comparaciones[0], tabContent);
};

const mostrarTab = (comparacion, contenedor) => {
    contenedor.innerHTML = '';

    const tabla = document.createElement("table");
    tabla.className = "tabla-resultado";

    const formatearCelda = (valor, esSuma = false) => {
        const texto = String(valor).trim();

        if (esSuma) {
            // Solo si es fila de suma, intentamos convertir a número
            const limpio = texto.replace(/[^\d.-]/g, '');
            const num = parseFloat(limpio);
            return `<div class="celda-scroll">${isNaN(num) ? '0' : num.toLocaleString('en-US')}</div>`;
        }

        // Para todo lo demás, simplemente mostrar texto con scroll o lista
        if (!texto.includes(',')) {
            return `<div class="celda-scroll">${texto}</div>`;
        }

        const items = texto.split(',').map(t => t.trim()).filter(t => t);
        return `
            <div class="celda-scroll">
                <ul class="lista-viñetas">
                    ${items.map(item => `<li>${item}</li>`).join('')}
                </ul>
            </div>`;
    };

    tabla.innerHTML = `
        <thead><tr><th>Variable</th><th>${comparacion.nombre1}</th><th>${comparacion.nombre2}</th></tr></thead>
        <tbody>
            ${comparacion.filas.map(f => {
                const esSuma = f[0].startsWith('Suma ');
                return `
                    <tr>
                        <td>${f[0]}</td>
                        <td>${formatearCelda(f[1], esSuma)}</td>
                        <td>${formatearCelda(f[2], esSuma)}</td>
                    </tr>`;
            }).join('')}
        </tbody>
    `;

    contenedor.appendChild(tabla);

    const canvas = document.createElement("canvas");
    canvas.className = "grafico-compacto";
    contenedor.appendChild(canvas);

    const sumas = comparacion.filas.filter(f => f[0].startsWith("Suma "));
    const labels = sumas.map(f => f[0]);
    const datos1 = sumas.map(f => parseFloat(f[1]));
    const datos2 = sumas.map(f => parseFloat(f[2]));

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: comparacion.nombre1, data: datos1, backgroundColor: 'rgba(54,162,235,0.6)' },
                { label: comparacion.nombre2, data: datos2, backgroundColor: 'rgba(255,99,132,0.6)' }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'top' },
                title: { display: true, text: 'Resumen comparativo (Sumas)' }
            }
        }
    });
};

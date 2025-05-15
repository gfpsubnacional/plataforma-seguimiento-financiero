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
                const decodedSample = new TextDecoder('utf-8', { fatal: false }).decode(uint8Array);
                const detected = jschardet.detect(decodedSample);
                const encoding = detected.encoding ? detected.encoding.toLowerCase() : 'utf-8';

                console.log(`Codificación detectada para ${file.name}: ${encoding}`);

                // Decodificar correctamente según la codificación detectada
                const decoder = new TextDecoder(encoding);
                const csvData = decoder.decode(arrayBuffer);

                const isTxt = file.name.toLowerCase().endsWith('.txt');
                console.log(`Contenido del archivo ${file.name}:\n`, csvData.slice(0, 300));

                Papa.parse(csvData, {
                    header: true,
                    dynamicTyping: true,
                    delimiter: isTxt ? '\t' : '',
                    complete: (results) => {
                        const data = results.data;
                        const filtered = data.filter(row =>
                            Object.values(row).some(val => val !== null && val !== '')
                        );

                        if (filtered.length === 0) {
                            alert(`El archivo "${file.name}" no contiene datos válidos.`);
                            return;
                        }

                        window.archivosCSV[inputId] = filtered;
                        console.log(`Archivo guardado en memoria con ID "${inputId}" (${file.name}):`, filtered);
                    }
                });
            };

            // Leer como ArrayBuffer para poder detectar codificación
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

// Botón para generar análisis
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

    let missingFiles = [];
    if (!caRaw) missingFiles.push('CA');
    if (!ceplanRaw) missingFiles.push('CEPLAN');
    if (!sigaRaw) missingFiles.push('SIGA');

    if (missingFiles.length > 0) {
        alert('Faltan los siguientes archivos: ' + missingFiles.join(', '));
        return;
    }

    // Normalizar columnas
    const caJson = normalizarClaves(caRaw);
    const ceplanJson = normalizarClaves(ceplanRaw);
    const sigaJson = normalizarClaves(sigaRaw);

    // Forzar columnas numéricas (quitar comas de miles, convertir a número)
    const columnasNumericas = [
        'DEV', 'PIA', 'PIM', 'Girado',
        'POI_aprobado', 'POI_consistente_PIA', 'POI modificado',
        'ITEM_IMPORTE'
    ];

    const limpiarNumericos = (data, columnas) => {
        return data.map(obj => {
            const copia = { ...obj };
            for (const col of columnas) {
                if (col in copia && typeof copia[col] === 'string') {
                    const limpio = copia[col].replace(/,/g, '').trim();
                    const valorNum = parseFloat(limpio);
                    copia[col] = isNaN(valorNum) ? 0 : valorNum;
                }
            }
            return copia;
        });
    };

    const caJsonNum = limpiarNumericos(caJson, columnasNumericas);
    const ceplanJsonNum = limpiarNumericos(ceplanJson, columnasNumericas);
    const sigaJsonNum = limpiarNumericos(sigaJson, columnasNumericas);

    const wb = XLSX.utils.book_new();

    const caSheet = XLSX.utils.json_to_sheet(caJsonNum);
    const ceplanSheet = XLSX.utils.json_to_sheet(ceplanJsonNum);
    const sigaSheet = XLSX.utils.json_to_sheet(sigaJsonNum);

    XLSX.utils.book_append_sheet(wb, caSheet, 'CA');
    XLSX.utils.book_append_sheet(wb, ceplanSheet, 'CEPLAN');
    XLSX.utils.book_append_sheet(wb, sigaSheet, 'SIGA');

    // Crear hoja de análisis con columnas una por fila
    const headersCA = Object.keys(caJson[0] || []);
    const headersCEPLAN = Object.keys(ceplanJson[0] || []);
    const headersSIGA = Object.keys(sigaJson[0] || []);

    const maxLength = Math.max(headersCA.length, headersCEPLAN.length, headersSIGA.length);
    const analysisData = [['CA', 'CEPLAN', 'SIGA']];

    for (let i = 0; i < maxLength; i++) {
        analysisData.push([
            headersCA[i] || '',
            headersCEPLAN[i] || '',
            headersSIGA[i] || ''
        ]);
    }

    const analysisSheet = XLSX.utils.aoa_to_sheet(analysisData);
    XLSX.utils.book_append_sheet(wb, analysisSheet, 'Variables');


    // ========== FUNCION ==========

    const generarHojaComparacion = ({
        data1,
        data2,
        data1Num,
        data2Num,
        nombre1 = 'BD1',
        nombre2 = 'BD2',
        filasListar = [],
        filasSumar = [],
        nombreHoja = 'Comparación'
    }) => {

        const obtenerUnicos = (data, col) => {
            const set = new Set(data.map(x => x[col]).filter(v => v != null && v !== ''));
            return [...set].sort().join('\n');
        };
    
        const sumarColumna = (data, col) => {
            const total = data.reduce((sum, x) => sum + (parseFloat(x[col]) || 0), 0);
            return Math.round(total * 100) / 100;
        };
    
        const analisisFilas = [];
    
        const agregarFila = (nombre, val1, val2) => {
            analisisFilas.push([nombre, val1 || '', val2 || '']);
        };
    
        for (const col of filasListar) {
            agregarFila(col, obtenerUnicos(data1, col), obtenerUnicos(data2, col));
        }
    
        for (const col of filasSumar) {
            agregarFila(`Suma ${col}`, sumarColumna(data1Num, col), sumarColumna(data2Num, col));
        }
    
        const hojaComparacion = [
            [`Tabla de comparación ${nombre1} con ${nombre2}`],
            ['Variable', nombre1, nombre2],
            ...analisisFilas
        ];
    
        const sheet = XLSX.utils.aoa_to_sheet(hojaComparacion);

        // FORMATO
        sheet['!cols'] = [
            { wch: 27 }, // ANCHO DE columna A
            { wch: 55 }, // columna B
            { wch: 55 }  // columna C
        ];

        // AGREGAR HOJA
        XLSX.utils.book_append_sheet(wb, sheet, nombreHoja);
    };
    
    
    // ========== CA vs CEPLAN ==========
    generarHojaComparacion({
        data1: caJson,
        data2: ceplanJson,
        data1Num: caJsonNum,
        data2Num: ceplanJsonNum,
        nombre1: 'CA',
        nombre2: 'CEPLAN',
        filasListar: ['sector', 'pliego', 'ejecutora', 'categoria_pptal', 'prod_proy', 'c_costo'],
        filasSumar: ['DEV', 'PIA', 'PIM', 'Girado', 'POI_aprobado', 'POI_consistente_PIA', 'POI modificado'],
        nombreHoja: 'CA vs CEPLAN'
    });

    // ========== CA vs SIGA ==========
    generarHojaComparacion({
        data1: caJson,
        data2: sigaJson,
        data1Num: caJsonNum,
        data2Num: sigaJsonNum,
        nombre1: 'CA',
        nombre2: 'SIGA',
        filasListar: ['sector', 'pliego', 'ejecutora', 'categoria_pptal', 'prod_proy', 'c_costo','generica','subgenerica'],
        filasSumar: ['DEV', 'PIA', 'PIM', 'Girado', 'ITEM_IMPORTE'],
        nombreHoja: 'CA vs SIGA'
    });
    
    // ========== CEPLAN vs SIGA ==========
    generarHojaComparacion({
        data1: ceplanJson,
        data2: sigaJson,
        data1Num: ceplanJsonNum,
        data2Num: sigaJsonNum,
        nombre1: 'CEPLAN',
        nombre2: 'SIGA',
        filasListar: ['sector', 'pliego', 'ejecutora', 'categoria_pptal', 'prod_proy', 'c_costo','generica','subgenerica'],
        filasSumar: ['ITEM_IMPORTE','POI_aprobado', 'POI_consistente_PIA', 'POI modificado'],
        nombreHoja: 'CEPLAN vs SIGA'
    });
        
    

    // ========== FIN ==========
    
    const excelFile = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    const link = document.getElementById('download-link');
    const blob = new Blob([excelFile], { type: 'application/octet-stream' });
    link.href = URL.createObjectURL(blob);
    link.download = 'analisis.xlsx';
    link.textContent = 'Descargar resultado';
    link.style.display = 'inline';
});

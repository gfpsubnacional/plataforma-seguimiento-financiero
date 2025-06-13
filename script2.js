// Limpiar almacenamiento al recargar o cerrar
window.addEventListener('beforeunload', () => {
    localStorage.clear();
    sessionStorage.clear();
});

window.archivosCSV = {};

// Global state for selected subgenericas, now for CA and SIGA
window.selectedSubgenericasCA = [];
window.selectedSubgenericasSIGA = []; // Changed from CEPLAN

const coloresInstitucionales = {
    'CA': {
        nombre: 'CA',
        colorHex: '#36A2EB',
        colorRGBA: 'rgba(54,162,235,0.6)',
        fondoTabla: 'rgba(54,162,235,0.1)',
        fondoOscuro: '#2b7bb9'
    },
    'CEPLAN': {
        nombre: 'CEPLAN',
        colorHex: '#FF6384',
        colorRGBA: 'rgba(255,99,132,0.6)',
        fondoTabla: 'rgba(255,99,132,0.1)',
        fondoOscuro: '#cc4d6a'
    },
    'SIGA': {
        nombre: 'SIGA',
        colorHex: '#90EE90',
        colorRGBA: 'rgba(144,238,144,0.6)',
        fondoTabla: 'rgba(144,238,144,0.1)',
        fondoOscuro: '#62c462'
    }
};

// --- Funciones para mostrar/ocultar el popup de carga ---
const showLoading = () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.remove('hidden');
    }
};

const hideLoading = () => {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
        loadingOverlay.classList.add('hidden');
    }
};
// --------------------------------------------------------


// Manejo de carga de archivos
document.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (event) => {
        const file = event.target.files[0];
        const inputId = input.id;
        if (file) {
            showLoading(); // Muestra el popup de carga al inicio de la subida
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
                } catch (error) {
                    // Fallback to windows-1252 with error logging for debugging
                    try {
                        csvData = new TextDecoder("windows-1252", { fatal: false }).decode(uint8Array);
                        console.log("Decodificado como fallback: Windows-1252");
                    } catch (decodeError) {
                        console.error(`Error decoding with windows-1252: ${decodeError.message}`);
                        alert(`No se pudo decodificar el archivo ${file.name}. Intente con otra codificación o verifique el archivo.`);
                        hideLoading(); // Oculta el popup si hay un error
                        return;
                    }
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
                            hideLoading(); // Oculta el popup si el archivo está vacío
                            return;
                        }

                        window.archivosCSV[inputId] = data;
                        console.log(`Archivo cargado (${inputId}):`, data);

                        // If CA or SIGA are loaded, update the subgenerica filter
                        if (inputId === 'ca' || inputId === 'siga') {
                            updateSubgenericaFilter();
                        }
                        hideLoading(); // Oculta el popup cuando el procesamiento del archivo termina
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
    showLoading(); // Muestra el popup de carga al presionar "Generar Análisis"
    let caRaw = window.archivosCSV['ca'];
    const ceplanRaw = window.archivosCSV['ceplan'];
    let sigaRaw = window.archivosCSV['siga'];

    const faltan = [];
    if (!caRaw) faltan.push('CA');
    if (!ceplanRaw) faltan.push('CEPLAN');
    if (!sigaRaw) faltan.push('SIGA');

    if (faltan.length) {
        alert('Faltan los siguientes archivos: ' + faltan.join(', '));
        hideLoading(); // Oculta el popup si faltan archivos
        return;
    }

    // Apply subgenerica filter for CA
    let filteredCaData = caRaw;
    if (window.selectedSubgenericasCA.length > 0) {
        filteredCaData = caRaw.filter(row => {
            const tempNormalizedRow = {};
            for (const key in row) {
                const claveNormalizada = normalizacionColumnas[key] || key;
                tempNormalizedRow[claveNormalizada] = row[key];
            }
            return window.selectedSubgenericasCA.includes(tempNormalizedRow.subgenerica);
        });
    }

    // Apply subgenerica filter for SIGA
    let filteredSigaData = sigaRaw;
    if (window.selectedSubgenericasSIGA.length > 0) {
        filteredSigaData = sigaRaw.filter(row => {
            const tempNormalizedRow = {};
            for (const key in row) {
                const claveNormalizada = normalizacionColumnas[key] || key;
                tempNormalizedRow[claveNormalizada] = row[key];
            }
            return window.selectedSubgenericasSIGA.includes(tempNormalizedRow.subgenerica);
        });
    }

    const caJson = normalizarClaves(filteredCaData);
    const ceplanJson = normalizarClaves(ceplanRaw);
    const sigaJson = normalizarClaves(filteredSigaData);

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

    // MODIFICACIÓN CLAVE AQUÍ: obtenerUnicos ahora devuelve un ARRAY
    const construirComparacion = (data1, data2, data1Num, data2Num, nombre1, nombre2, listar, sumar) => {
        // Esta función ahora devuelve un ARRAY de strings únicos
        const obtenerUnicos = (data, col) => [...new Set(data.map(x => x[col]).filter(Boolean))].sort();
        const sumarColumna = (data, col) => Math.round(data.reduce((acc, x) => acc + (parseFloat(x[col]) || 0), 0) * 100) / 100;

        const filas = [];

        // Ahora pasamos el ARRAY de strings a la fila
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
    hideLoading(); // Oculta el popup cuando los resultados están listos
});

// === Mostrar resultados en la web ===
const mostrarResultadosVisuales = (comparaciones) => {
    // Verificar si ya existe el contenedor, si no, crearlo y colocarlo en el DOM
    let container = document.getElementById("resultados-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "resultados-container";
        // Insert before the main-container to place it at the top
        const mainContainer = document.querySelector('.main-container');
        if (mainContainer) {
            document.body.insertBefore(container, mainContainer);
        } else {
            document.body.appendChild(container); // Fallback if main-container not found
        }
    }
    container.innerHTML = '';

    // Create the filter button and insert it at the top of the results container
    let filterButtonContainer = document.getElementById('filter-button-container');
    if (!filterButtonContainer) {
        filterButtonContainer = document.createElement('div');
        filterButtonContainer.id = 'filter-button-container';
        filterButtonContainer.style.textAlign = 'center';
        filterButtonContainer.style.marginBottom = '20px';
        container.appendChild(filterButtonContainer); // Append to the results container first
    }
    filterButtonContainer.innerHTML = ''; // Clear previous button if any

    const filterButton = document.createElement('button');
    filterButton.id = 'filter-subgenerica-btn';
    filterButton.textContent = '⚙️ Filtrar por Subgenérica';
    filterButton.className = 'btn-filter';
    filterButtonContainer.appendChild(filterButton);

    filterButton.addEventListener('click', () => {
        const modal = document.getElementById('subgenerica-filter-modal');
        if (modal) {
            modal.classList.remove('hidden');
            updateSubgenericaFilter(); // Ensure filter options are updated when modal opens
        }
    });

    // Crear encabezado de tabs
    const tabHeader = document.createElement("div");
    tabHeader.className = "tabs";

    // Crear botón PDF a la derecha
    const botonPDF = document.createElement("button");
    botonPDF.id = "descargar-pdf-btn";
    botonPDF.textContent = "📄 Descargar PDF";
    botonPDF.className = "btn-descargar-pdf";
    botonPDF.addEventListener('click', () => {
        const opt = {
            margin: 0.5,
            filename: 'reporte_comparativo.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        };
        // Use the container to generate the PDF
        html2pdf().set(opt).from(container).save();
    });

    // Agrupar tabs y botón en wrapper
    const tabWrapper = document.createElement("div");
    tabWrapper.className = "tab-wrapper";
    tabWrapper.appendChild(tabHeader);
    tabWrapper.appendChild(botonPDF);

    // Crear contenido de tabs
    const tabContent = document.createElement("div");
    tabContent.className = "tab-content";

    // Generar botones de tabs
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

    // Insert tabWrapper and tabContent AFTER the filterButtonContainer
    container.appendChild(tabWrapper);
    container.appendChild(tabContent);

    // Mostrar la primera pestaña
    if (comparaciones.length > 0) {
        mostrarTab(comparaciones[0], tabContent);
    }
};

const mostrarTab = (comparacion, contenedor) => {
    contenedor.innerHTML = '';

    const tabla = document.createElement("table");
    tabla.className = "tabla-resultado";

    // MODIFICACIÓN CLAVE AQUÍ: formatearCelda ahora espera un ARRAY
    const formatearCelda = (valor, esSuma = false) => {
        if (esSuma) {
            // Esto sigue siendo para números
            const texto = String(valor).trim();
            const limpio = texto.replace(/[^\d.-]/g, '');
            const num = parseFloat(limpio);
            return `<div class="celda-scroll">${isNaN(num) ? '0' : num.toLocaleString('en-US')}</div>`;
        }

        // Si valor es un ARRAY, asumimos que son los elementos de la lista
        if (Array.isArray(valor)) {
            // Filtra elementos vacíos y genera la lista de viñetas
            const items = valor.filter(t => t !== null && t !== undefined && String(t).trim() !== '');
            if (items.length === 0) {
                return `<div class="celda-scroll"></div>`; // Retorna vacío si no hay elementos válidos
            }
            return `
                <div class="celda-scroll">
                    <ul class="lista-viñetas">
                        ${items.map(item => `<li>${item}</li>`).join('')}
                    </ul>
                </div>
            `;
        }

        // Si no es una suma ni un array, trátalo como un texto simple
        return `<div class="celda-scroll">${String(valor).trim()}</div>`;
    };

    tabla.innerHTML = `
        <thead>
            <tr>
                <th>Variable</th>
                <th style="background-color: ${coloresInstitucionales[comparacion.nombre1]?.fondoOscuro}; color: white;">
                    ${comparacion.nombre1}
                </th>
                <th style="background-color: ${coloresInstitucionales[comparacion.nombre2]?.fondoOscuro}; color: white;">
                    ${comparacion.nombre2}
                </th>
            </tr>
        </thead>
        <tbody>
            ${comparacion.filas.map(f => {
                const esSuma = f[0].startsWith('Suma ');
                return `
                    <tr>
                        <td>${f[0]}</td>
                        <td style="background-color: ${coloresInstitucionales[comparacion.nombre1]?.fondoTabla};">
                            ${formatearCelda(f[1], esSuma)}
                        </td>
                        <td style="background-color: ${coloresInstitucionales[comparacion.nombre2]?.fondoTabla};">
                            ${formatearCelda(f[2], esSuma)}
                        </td>
                    </tr>
                `;
            }).join('')}
        </tbody>
    `;
    contenedor.appendChild(tabla);

    const canvas = document.createElement("canvas");
    canvas.className = "grafico-compacto";
    contenedor.appendChild(canvas);

    const sumas = comparacion.filas.filter(f => f[0].startsWith("Suma "));
    const labels = sumas.map(f => f[0].replace('Suma ', ''));
    const datos1 = sumas.map(f => parseFloat(f[1]));
    const datos2 = sumas.map(f => parseFloat(f[2]));

    new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: comparacion.nombre1,
                    data: datos1,
                    backgroundColor: coloresInstitucionales[comparacion.nombre1]?.colorRGBA || 'gray'
                },
                {
                    label: comparacion.nombre2,
                    data: datos2,
                    backgroundColor: coloresInstitucionales[comparacion.nombre2]?.colorRGBA || 'gray'
                }
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

// --- Subgenerica Filter Logic (remains largely the same) ---

document.addEventListener('DOMContentLoaded', () => {
    // Dynamically create and append the filter modal (it will be hidden by default)
    const filterModal = document.createElement('div');
    filterModal.id = 'subgenerica-filter-modal';
    filterModal.className = 'filter-modal hidden'; // Hidden by default

    filterModal.innerHTML = `
        <div class="filter-modal-content">
            <span class="close-button" id="filter-modal-close">&times;</span>
            <h2>Filtrar por Subgenérica</h2>
            <div class="filter-sections">
                <div class="filter-section">
                    <h3>CA Subgenéricas</h3>
                    <div id="ca-subgenericas" class="subgenerica-list">
                        </div>
                </div>
                <div class="filter-section">
                    <h3>SIGA Subgenéricas</h3>
                    <div id="siga-subgenericas" class="subgenerica-list">
                        </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(filterModal);

    // Add event listener to close the filter modal
    document.getElementById('filter-modal-close').addEventListener('click', () => {
        document.getElementById('subgenerica-filter-modal').classList.add('hidden');
    });

    // --- Add the loading overlay HTML to the body on DOMContentLoaded ---
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.className = 'loading-overlay hidden';
    loadingOverlay.innerHTML = `
        <div class="loading-content">
            <div class="loading-spinner"></div>
            <div class="loading-text">Cargando...</div>
        </div>
    `;
    document.body.appendChild(loadingOverlay);
    // -----------------------------------------------------------------

});

// Function to update and display the subgenerica filter
const updateSubgenericaFilter = () => {
    const caData = window.archivosCSV['ca'];
    const sigaData = window.archivosCSV['siga'];

    const caSubgenericasDiv = document.getElementById('ca-subgenericas');
    const sigaSubgenericasDiv = document.getElementById('siga-subgenericas');

    if (!caSubgenericasDiv || !sigaSubgenericasDiv) return; // Ensure elements exist

    caSubgenericasDiv.innerHTML = '';
    sigaSubgenericasDiv.innerHTML = '';

    // Extract unique subgenericas from normalized data
    const getUniqueSubgenericas = (data) => {
        if (!data) return [];
        // Normalizing here to ensure 'subgenerica' key exists before extracting
        const normalizedData = data.map(obj => {
            const nuevo = {};
            for (const key in obj) {
                const claveNormalizada = normalizacionColumnas[key] || key;
                nuevo[claveNormalizada] = obj[key];
            }
            return nuevo;
        });
        return [...new Set(normalizedData.map(row => row.subgenerica).filter(Boolean))].sort();
    };

    const uniqueCASubgenericas = getUniqueSubgenericas(caData);
    const uniqueSIGASubgenericas = getUniqueSubgenericas(sigaData);

    // Initialize selectedSubgenericas if they are empty (first load or new file)
    // and if there are actual subgenericas to select
    if (window.selectedSubgenericasCA.length === 0 && uniqueCASubgenericas.length > 0) {
        window.selectedSubgenericasCA = [...uniqueCASubgenericas];
    } else {
        // If unique subgenericas change (e.g., new file loaded), filter out old selected ones
        window.selectedSubgenericasCA = window.selectedSubgenericasCA.filter(sg => uniqueCASubgenericas.includes(sg));
        // If after filtering, no subgenericas are selected but there are new ones, re-select all new ones
        if (window.selectedSubgenericasCA.length === 0 && uniqueCASubgenericas.length > 0) {
            window.selectedSubgenericasCA = [...uniqueCASubgenericas];
        }
    }

    // Logic for SIGA Subgenericas
    if (window.selectedSubgenericasSIGA.length === 0 && uniqueSIGASubgenericas.length > 0) {
        window.selectedSubgenericasSIGA = [...uniqueSIGASubgenericas];
    } else {
        window.selectedSubgenericasSIGA = window.selectedSubgenericasSIGA.filter(sg => uniqueSIGASubgenericas.includes(sg));
        if (window.selectedSubgenericasSIGA.length === 0 && uniqueSIGASubgenericas.length > 0) {
            window.selectedSubgenericasSIGA = [...uniqueSIGASubgenericas];
        }
    }


    const createCheckboxList = (subgenericas, datasetName, selectedList, containerDiv) => {
        if (subgenericas.length === 0) {
            containerDiv.innerHTML = '<p>No hay subgenéricas disponibles.</p>';
            return;
        }
        subgenericas.forEach(sg => {
            const checkboxDiv = document.createElement('div');
            checkboxDiv.className = 'checkbox-item';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = `${datasetName}-${sg.replace(/[^a-zA-Z0-9]/g, '_')}`; // Sanitize ID for special chars
            checkbox.value = sg;
            checkbox.checked = selectedList.includes(sg);

            const label = document.createElement('label');
            label.htmlFor = `${datasetName}-${sg.replace(/[^a-zA-Z0-9]/g, '_')}`;
            label.textContent = sg;

            checkbox.addEventListener('change', (event) => {
                if (datasetName === 'ca') {
                    if (event.target.checked) {
                        window.selectedSubgenericasCA.push(sg);
                    } else {
                        window.selectedSubgenericasCA = window.selectedSubgenericasCA.filter(item => item !== sg);
                    }
                } else if (datasetName === 'siga') {
                    if (event.target.checked) {
                        window.selectedSubgenericasSIGA.push(sg);
                    } else {
                        window.selectedSubgenericasSIGA = window.selectedSubgenericasSIGA.filter(item => item !== sg);
                    }
                }
                // Trigger re-processing and re-rendering
                // Only if all necessary files are already loaded.
                if (window.archivosCSV['ca'] && window.archivosCSV['ceplan'] && window.archivosCSV['siga']) {
                    document.getElementById('process-btn').click();
                }
            });

            checkboxDiv.appendChild(checkbox);
            checkboxDiv.appendChild(label);
            containerDiv.appendChild(checkboxDiv);
        });
    };

    createCheckboxList(uniqueCASubgenericas, 'ca', window.selectedSubgenericasCA, caSubgenericasDiv);
    createCheckboxList(uniqueSIGASubgenericas, 'siga', window.selectedSubgenericasSIGA, sigaSubgenericasDiv);
};
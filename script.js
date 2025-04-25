// Borrar todo el Local Storage cuando se actualice o se cierre la página
window.addEventListener('beforeunload', () => {
    localStorage.clear();
});

// Función para manejar la carga de archivos
document.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', (event) => {
        const file = event.target.files[0];
        const inputId = input.id; // Obtener el id del input
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const csvData = e.target.result;
                
                // Convertir CSV a JSON usando PapaParse
                Papa.parse(csvData, {
                    header: true, // Considerar la primera fila como encabezado
                    dynamicTyping: true, // Convertir tipos de datos automáticamente
                    complete: (results) => {
                        // Guardar el JSON en Local Storage con el id del input como clave
                        localStorage.setItem(inputId, JSON.stringify(results.data));

                        // Logear el JSON y el nombre del archivo desde Local Storage
                        const storedData = JSON.parse(localStorage.getItem(inputId));
                        console.log(`JSON guardado en Local Storage para el archivo con id "${inputId}" y nombre "${file.name}":`, storedData);
                    }
                });
            };
            reader.readAsText(file);
        }
    });
});

// Función para abrir los pop-ups con contenido dinámico
document.querySelectorAll('[data-popup]').forEach(button => {
    button.addEventListener('click', () => {
        const src = button.getAttribute('data-popup');
        const popup = document.getElementById('popup');
        const iframe = document.getElementById('popup-iframe');
        iframe.src = src;
        popup.classList.remove('hidden');
    });
});

// Función para cerrar el pop-up
document.getElementById('popup-close').addEventListener('click', () => {
    document.getElementById('popup').classList.add('hidden');
    document.getElementById('popup-iframe').src = '';
});

// Placeholder para el botón de procesamiento
document.getElementById('process-btn').addEventListener('click', () => {
    // Verificar si existen los datos en Local Storage
    const caData = localStorage.getItem('ca');
    const ceplanData = localStorage.getItem('ceplan');
    const sigaData = localStorage.getItem('siga');

    // Crear una lista de los archivos faltantes
    let missingFiles = [];
    if (!caData) missingFiles.push('CA');
    if (!ceplanData) missingFiles.push('CEPLAN');
    if (!sigaData) missingFiles.push('SIGA');

    // Si faltan archivos, mostrar un mensaje
    if (missingFiles.length > 0) {
        alert('Faltan los siguientes archivos: ' + missingFiles.join(', '));
        return;
    }

    // Convertir los datos de Local Storage de JSON a objeto
    const caJson = JSON.parse(caData);
    const ceplanJson = JSON.parse(ceplanData);
    const sigaJson = JSON.parse(sigaData);

    // Crear una nueva hoja para cada conjunto de datos
    const wb = XLSX.utils.book_new();

    // Convertir JSON a hojas de Excel
    const caSheet = XLSX.utils.json_to_sheet(caJson);
    const ceplanSheet = XLSX.utils.json_to_sheet(ceplanJson);
    const sigaSheet = XLSX.utils.json_to_sheet(sigaJson);

    // Agregar las hojas al libro con nombres en mayúsculas
    XLSX.utils.book_append_sheet(wb, caSheet, 'CA');
    XLSX.utils.book_append_sheet(wb, ceplanSheet, 'CEPLAN');
    XLSX.utils.book_append_sheet(wb, sigaSheet, 'SIGA');

    // Generar el archivo Excel
    const excelFile = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

    // Crear un enlace de descarga
    const link = document.getElementById('download-link');
    const blob = new Blob([excelFile], { type: 'application/octet-stream' });
    link.href = URL.createObjectURL(blob);
    link.download = 'analisis.xlsx';
    link.textContent = 'Descargar resultado';
    link.style.display = 'inline';
});

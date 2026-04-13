document.addEventListener('DOMContentLoaded', () => {
    // === CONTROL DE ACCESO ===
    const userSession = JSON.parse(sessionStorage.getItem('userSession'));
    if (!userSession || userSession.role.toLowerCase() !== 'picker') {
        window.location.href = 'login.html';
        return;
    }

    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwzjthPZvtAH-R_H1h5GNMe0p5-8ofbODHenwXBHTmRArn_phXq8lwbwRq28s3_iO11/exec'; // <- REEMPLAZA
    const currentPicker = userSession.username; 
    document.getElementById('current-picker-name').textContent = currentPicker;

    const navBtns = document.querySelectorAll('.mobile-nav-btn');
    const panels = document.querySelectorAll('.panel');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    function showLoading(text) { loadingText.textContent = text; loadingOverlay.classList.remove('hidden'); }
    function hideLoading() { loadingOverlay.classList.add('hidden'); }

    // === NAVEGACIÓN ===
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.add('hidden'));
            btn.classList.add('active');
            
            const target = btn.getAttribute('data-target');
            document.getElementById(target).classList.remove('hidden');
            
            if(target === 'view-queue') loadQueue();
            if(target === 'view-crear') loadExpectedOffcuts();
        });
    });

    // === 1. CARGA DE LISTA (LIFO) ===
    async function loadQueue() {
        const queueList = document.getElementById('my-queue-list');
        showLoading("Actualizando cola...");
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getPickerQueue', payload: { picker: currentPicker } }) });
            const result = await response.json();
            
            queueList.innerHTML = '';
            if(result.data.length === 0) { queueList.innerHTML = '<div class="card"><p class="text-muted text-center">No tienes batches pendientes.</p></div>'; return; }

            result.data.forEach((batch, index) => {
                let isTop = index === 0; 
                queueList.innerHTML += `
                    <div class="card mb-1" style="border-left: 5px solid ${isTop ? 'var(--danger)' : 'var(--primary)'}; cursor:pointer" onclick="viewBatchDetail('${batch.id}')">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <strong>Lote: ${batch.id}</strong>
                            ${isTop ? '<span style="background:var(--danger);color:white;padding:2px 5px;border-radius:4px;font-size:10px;">PRÓXIMO</span>' : ''}
                        </div>
                        <p class="text-sm text-muted">Piezas Pendientes: ${batch.count}</p>
                    </div>`;
            });
        } catch (error) { alert("Error cargando cola."); } finally { hideLoading(); }
    }
    
    document.getElementById('btn-refresh-queue').addEventListener('click', loadQueue);
    loadQueue();

    // === 2. DETALLE DEL BATCH ===
    window.viewBatchDetail = async (batchId) => {
        document.getElementById('view-queue').classList.add('hidden');
        document.getElementById('view-batch-detail').classList.remove('hidden');
        document.getElementById('detail-batch-title').textContent = `Lote: ${batchId}`;
        
        const container = document.getElementById('batch-remnants-container');
        container.innerHTML = '';
        showLoading("Cargando mapas y piezas...");

        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getBatchDetails', payload: { batch_id: batchId } }) });
            const result = await response.json();

            let grouped = {};
            result.data.forEach(p => {
                if(!grouped[p.rem_id]) grouped[p.rem_id] = { pieces: [], rem_w: 0, rem_c: 0 };
                grouped[p.rem_id].pieces.push(p);
                if(p.map_data) {
                    let md = typeof p.map_data === 'string' ? JSON.parse(p.map_data) : p.map_data;
                    grouped[p.rem_id].rem_w = md.rem_w; grouped[p.rem_id].rem_c = md.rem_c; p.parsed_map = md; 
                }
            });

            for(let remId in grouped) {
                let data = grouped[remId];
                let isNewMaterial = remId === 'Sin Asignar' || remId === 'Pendiente';
                
                let html = `
                    <div class="card mb-1 remnant-card" id="card-${remId}" style="border: 2px solid ${isNewMaterial ? '#cbd5e1' : '#3b82f6'};">
                        <h4 style="margin-bottom: 0.5rem; color: ${isNewMaterial ? '#475569' : '#1d4ed8'};">${isNewMaterial ? 'Cortar de Material Nuevo' : 'Ir al Rack por: ' + remId}</h4>
                        <p class="text-sm text-muted mb-1">Contiene ${data.pieces.length} pieza(s).</p>
                `;

                if(!isNewMaterial && data.rem_w > 0) {
                    html += `<div class="fabric-container" style="background:#e2e8f0; position:relative; width:100%; aspect-ratio:1/1; border:1px solid #94a3b8; overflow:hidden;">`;
                    data.pieces.forEach(p => {
                        if(p.parsed_map) {
                            let md = p.parsed_map;
                            let pctX = (md.x / data.rem_w) * 100, pctY = (md.y / data.rem_c) * 100, pctW = (md.req_w / data.rem_w) * 100, pctC = (md.req_c / data.rem_c) * 100;
                            html += `<div class="fabric-cut" style="position:absolute; background:rgba(37,99,235,0.7); border:1px solid #1e3a8a; left:${pctX}%; top:${pctY}%; width:${pctW}%; height:${pctC}%; color:white; font-size:10px; display:flex; align-items:center; justify-content:center;"><span>${p.sfid.slice(-5)}</span></div>`;
                        }
                    });
                    html += `</div>`;
                }

                if(!isNewMaterial) {
                    html += `
                        <div class="mt-1" style="background:#f8fafc; padding:10px; border-radius:4px;">
                            <input type="text" id="scan-${remId}" data-batch="${batchId}" data-rem="${remId}" placeholder="Escanea código aquí" class="scan-input" style="width:100%; margin-bottom:10px; padding:10px; font-size:1.2rem; text-align:center;">
                            <div style="display:flex; gap:10px;">
                                <button class="btn-success" style="flex:1;" onclick="processRemnant('${batchId}', '${remId}', 'SUCCESS')">Confirmar</button>
                                <button class="btn-danger" style="flex:1;" onclick="processRemnant('${batchId}', '${remId}', 'MISSING')">No Encontrado</button>
                            </div>
                        </div>
                    `;
                } else {
                    html += `<button class="btn-success mt-1" style="width:100%" onclick="processRemnant('${batchId}', '${remId}', 'SUCCESS')">Marcar Como Listo</button>`;
                }
                html += `</div>`;
                container.innerHTML += html;
            }

            // AUTO-FOCUS
            setTimeout(() => {
                const inputs = document.querySelectorAll('.scan-input');
                if(inputs.length > 0) {
                    inputs[0].focus(); 
                    inputs.forEach(input => {
                        input.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') { e.preventDefault(); processRemnant(input.dataset.batch, input.dataset.rem, 'SUCCESS'); }
                        });
                    });
                } else if(Object.keys(grouped).length === 0) { backToQueue(); }
            }, 100);

        } catch (error) { container.innerHTML = '<p style="color:red">Error de red.</p>'; } finally { hideLoading(); }
    };

    window.backToQueue = () => { document.getElementById('view-batch-detail').classList.add('hidden'); document.getElementById('view-queue').classList.remove('hidden'); loadQueue(); };

    window.processRemnant = async (batchId, remId, actionType) => {
        if(actionType === 'SUCCESS' && remId !== 'Sin Asignar' && remId !== 'Pendiente') {
            const inputEl = document.getElementById(`scan-${remId}`);
            if(inputEl.value.trim() !== remId) { alert("Código incorrecto."); inputEl.value = ''; inputEl.focus(); return; }
        }

        if(actionType === 'MISSING' && !confirm(`¿Seguro que no encuentras el remanente ${remId}?`)) return;

        showLoading("Registrando...");
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'processBatchRemnant', payload: { batch_id: batchId, rem_id: remId, actionType: actionType } }) });
            await response.json();
            
            const card = document.getElementById(`card-${remId}`);
            if(card) card.remove();

            const nextInput = document.querySelector('.scan-input');
            if(nextInput) nextInput.focus(); else { alert("¡Lote completado!"); backToQueue(); }
        } catch (error) { alert("Error al registrar."); } finally { hideLoading(); }
    };

    // === 3. PRE-ALTAS (SOBRANTES) ===
    async function loadExpectedOffcuts() {
        const list = document.getElementById('expected-offcuts-list');
        showLoading("Buscando pre-altas...");
        list.innerHTML = '';
        
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getExpectedOffcuts' }) });
            const result = await response.json();
            
            if(result.data.length === 0) { list.innerHTML = '<div class="card"><p class="text-muted text-center">No hay remanentes pendientes.</p></div>'; return; }

            result.data.forEach(off => {
                list.innerHTML += `
                    <div class="card mb-1" id="offcut-${off.id}">
                        <h4 style="color: #059669; margin-bottom: 5px;">NUEVO: ${off.id}</h4>
                        <p class="text-sm">PCN: <b>${off.pcn}</b> | W:${off.w} x C:${off.c}</p>
                        <div class="mt-1" style="display:flex; gap:10px;">
                            <input type="text" id="loc-${off.id}" placeholder="Rack (Ej: A-12)" style="flex:1; padding:8px; border:1px solid #ccc;">
                            <button class="btn-success" onclick="confirmOffcut('${off.id}', 'CONFIRM')" style="width:auto;">Alta</button>
                        </div>
                        <div class="mt-1" style="border-top:1px dashed #ccc; padding-top:10px; display:flex; gap:10px;">
                            <input type="text" id="reason-${off.id}" placeholder="Motivo de daño..." style="flex:1; padding:8px; border:1px solid #ccc;">
                            <button class="btn-danger" onclick="confirmOffcut('${off.id}', 'REJECT')" style="width:auto;">Descartar</button>
                        </div>
                    </div>`;
            });
        } catch (error) { list.innerHTML = '<p style="color:red">Error de red.</p>'; } finally { hideLoading(); }
    }

    window.confirmOffcut = async (id, actionType) => {
        let payload = { id: id, actionType: actionType };
        if (actionType === 'CONFIRM') {
            payload.location = document.getElementById(`loc-${id}`).value.trim();
            if(!payload.location) return alert("Especifica el Rack.");
        } else {
            payload.reason = document.getElementById(`reason-${id}`).value.trim();
            if(!payload.reason) return alert("Especifica el motivo de descarte.");
        }

        showLoading("Procesando...");
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'confirmOffcut', payload: payload }) });
            await response.json();
            const el = document.getElementById(`offcut-${id}`); if(el) el.remove(); 
        } catch (error) { alert("Error."); } finally { hideLoading(); }
    };
});
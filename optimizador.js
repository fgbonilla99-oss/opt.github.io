document.addEventListener('DOMContentLoaded', () => {
    // === CONTROL DE ACCESO (Rutas Protegidas) ===
    const userSession = JSON.parse(sessionStorage.getItem('userSession'));
    if (!userSession || userSession.role.toLowerCase() !== 'optimizador') {
        window.location.href = 'login.html';
        return; // Detener ejecución
    }

    // === CONFIGURACIÓN ===
    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwzjthPZvtAH-R_H1h5GNMe0p5-8ofbODHenwXBHTmRArn_phXq8lwbwRq28s3_iO11/exec'; 

    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    function showLoading(text) { if(loadingText) loadingText.textContent = text; if(loadingOverlay) loadingOverlay.classList.remove('hidden'); }
    function hideLoading() { if(loadingOverlay) loadingOverlay.classList.add('hidden'); }

    // === NAVEGACIÓN Y CIERRE DE SESIÓN ===
    const navButtons = document.querySelectorAll('.nav-btn');
    const panels = document.querySelectorAll('.panel');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.add('hidden'));
            btn.classList.add('active');
            
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');
            if(targetId === 'panel-asignar' || targetId === 'panel-reasignar') loadBatches();
        });
    });

    document.getElementById('logout-btn').addEventListener('click', () => { 
        sessionStorage.removeItem('userSession');
        window.location.href = 'login.html'; 
    });

    let selectedBatches = [];
    let selectedPicker = null;

    document.addEventListener('click', (e) => {
        const pickerCard = e.target.closest('.picker-card');
        if (pickerCard) {
            document.querySelectorAll('.picker-card').forEach(c => c.classList.remove('selected'));
            pickerCard.classList.add('selected');
            selectedPicker = pickerCard.dataset.id;
            checkAssignReady();
        }

        const batchCard = e.target.closest('.batch-card');
        if (batchCard) {
            batchCard.classList.toggle('selected');
            const bId = batchCard.dataset.id;
            if (batchCard.classList.contains('selected')) {
                if (!selectedBatches.includes(bId)) selectedBatches.push(bId);
            } else {
                selectedBatches = selectedBatches.filter(id => id !== bId);
            }
            checkAssignReady();
        }
    });

    function checkAssignReady() {
        const btn = document.getElementById('btn-execute-asignar');
        if(btn) {
            btn.disabled = !(selectedBatches.length > 0 && selectedPicker);
            btn.textContent = selectedBatches.length > 0 ? `Asignar ${selectedBatches.length} Lote(s)` : 'Confirmar Asignación';
        }
    }

    // === MÓDULO 1: OPTIMIZACIÓN MASIVA 2D ===
    let dbRemanentes = []; let dbCondiciones = {}; let pcnToFamilyMap = {};
    let groupedByRemnantGlobal = {}; let unassignedGlobal = []; let finalOffcutsGlobal = []; let flatOrdersGlobal = [];

    const btnPreOptimize = document.getElementById('btn-pre-optimize');
    const btnSaveBatch = document.getElementById('btn-save-batch');
    const excelDataArea = document.getElementById('excel-data');
    const previewSection = document.getElementById('optimization-preview');
    const mapsContainer = document.getElementById('maps-container');
    const summaryText = document.getElementById('summary-text');
    const btnViewPdf = document.getElementById('btn-view-pdf');

    class Packer {
        constructor(w, c) { this.root = { x: 0, y: 0, w: w, c: c }; }
        fit(blocks) {
            let node;
            for (let n = 0; n < blocks.length; n++) {
                let block = blocks[n];
                if (node = this.findNode(this.root, block.req_w, block.req_c)) block.fit = this.splitNode(node, block.req_w, block.req_c);
            }
        }
        findNode(root, w, c) {
            if (root.used) return this.findNode(root.right, w, c) || this.findNode(root.down, w, c);
            else if ((w <= root.w) && (c <= root.c)) return root;
            else return null;
        }
        splitNode(node, w, c) {
            node.used = true;
            node.down  = { x: node.x, y: node.y + c, w: node.w, c: node.c - c };
            node.right = { x: node.x + w, y: node.y, w: node.w - w, c: c };
            return node;
        }
    }

    if (btnPreOptimize) {
        btnPreOptimize.addEventListener('click', async () => {
            const rawText = excelDataArea.value.trim();
            if (!rawText) return;
            showLoading('Optimizando los recursos...');
            btnPreOptimize.disabled = true;

            try {
                const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getDataForOptimization' }) });
                const result = await response.json();
                if(result.status !== 'success') throw new Error(result.message);

                dbRemanentes = result.data.remanentes;
                dbCondiciones = result.data.condiciones;
                pcnToFamilyMap = result.data.pcnToFamily;

                const orders = parseExcelData(rawText);
                run2DOptimization(orders);
                render2DMaps();
                previewSection.classList.remove('hidden');
                if(btnViewPdf) btnViewPdf.classList.remove('hidden');

            } catch (error) { alert(error.message); } 
            finally { hideLoading(); btnPreOptimize.disabled = false; }
        });
    }

    function parseExcelData(rawText) {
        return rawText.split('\n').map(row => {
            const cols = row.split('\t');
            if (cols.length >= 5 && cols[0].trim() !== '') {
                return { batch_id: cols[0].trim(), shop_floor_id: cols[1].trim(), fabric_pcn: cols[2].trim(), fabric_width: parseFloat(cols[3].trim().replace(',', '.')), fabric_cells: parseInt(cols[4].trim()) };
            } return null;
        }).filter(o => o && !isNaN(o.fabric_width));
    }

    function run2DOptimization(orders) {
        let availableRemnants = JSON.parse(JSON.stringify(dbRemanentes));
        unassignedGlobal = []; groupedByRemnantGlobal = {}; finalOffcutsGlobal = [];

        let blocks = orders.map(order => {
            let family = pcnToFamilyMap[order.fabric_pcn] || null;
            let cond = dbCondiciones[family] || { tol_width: 0, tol_cells: 0, min_width: 25, min_cells: 45 };
            return {
                ...order, family_obj: cond, family_name: family,
                req_w: order.fabric_width + (cond.tol_width * 2), req_c: order.fabric_cells + cond.tol_cells,
                area: (order.fabric_width + (cond.tol_width * 2)) * (order.fabric_cells + cond.tol_cells)
            };
        });

        blocks.sort((a, b) => b.area - a.area);

        for (let block of blocks) {
            let packed = false;
            
            for (let remId in groupedByRemnantGlobal) {
                let remData = groupedByRemnantGlobal[remId].remData;
                if (remData.pcn !== block.fabric_pcn || groupedByRemnantGlobal[remId].assigned_batch !== block.batch_id) continue;

                let currentBlocksInRem = groupedByRemnantGlobal[remId].blocks;
                let testPacker = new Packer(remData.width, remData.cells);
                
                let testBlocks = [...currentBlocksInRem, block].map(b => ({...b}));
                testBlocks.sort((a, b) => b.area - a.area); 
                testPacker.fit(testBlocks);

                if (testBlocks.every(b => b.fit)) {
                    groupedByRemnantGlobal[remId].blocks = testBlocks; 
                    groupedByRemnantGlobal[remId].packer = testPacker; 
                    packed = true; break;
                }
            }

            if (!packed) {
                let candidatos = availableRemnants.filter(r => r.pcn === block.fabric_pcn && r.width >= block.req_w && r.cells >= block.req_c);
                if (candidatos.length > 0) {
                    candidatos.sort((a, b) => (a.width * a.cells) - (b.width * b.cells));
                    let selected = candidatos[0];
                    let packer = new Packer(selected.width, selected.cells);
                    let clonedBlock = {...block};
                    packer.fit([clonedBlock]);

                    groupedByRemnantGlobal[selected.id] = { remData: selected, blocks: [clonedBlock], assigned_batch: block.batch_id, packer: packer };
                    availableRemnants = availableRemnants.filter(r => r.id !== selected.id); 
                    packed = true;
                }
            }

            if (!packed) unassignedGlobal.push(block);
        }
        buildFinalData();
    }

    function buildFinalData() {
        flatOrdersGlobal = []; finalOffcutsGlobal = [];

        for (let remId in groupedByRemnantGlobal) {
            let group = groupedByRemnantGlobal[remId];
            let remData = group.remData;
            let familyCond = dbCondiciones[group.blocks[0].family_name] || { min_width: 25, min_cells: 45 };
            let minW = familyCond.min_width || 25, minC = familyCond.min_cells || 45;

            function findOffcuts(node) {
                if (node.used) {
                    if (node.right) findOffcuts(node.right);
                    if (node.down) findOffcuts(node.down);
                } else if (node.w >= minW && node.c >= minC) {
                    finalOffcutsGlobal.push({
                        new_id: 'OFF-' + remId.slice(-4) + '-' + Math.floor(Math.random()*1000),
                        pcn: remData.pcn, familia: group.blocks[0].family_name,
                        width: node.w, cells: node.c, x: node.x, y: node.y, parent_rem: remId
                    });
                }
            }
            if(group.packer) findOffcuts(group.packer.root);

            group.blocks.forEach(b => { 
                flatOrdersGlobal.push({ 
                    ...b, remanente_asignado: remId,
                    map_data: b.fit ? { x: b.fit.x, y: b.fit.y, req_w: b.req_w, req_c: b.req_c, rem_w: remData.width, rem_c: remData.cells } : null
                }); 
            });
        }
        
        unassignedGlobal.forEach(u => { flatOrdersGlobal.push({ ...u, remanente_asignado: 'Sin Asignar', map_data: null }); });
    }

    function render2DMaps() {
        mapsContainer.innerHTML = '';
        let totalAsignados = 0;

        for (let remId in groupedByRemnantGlobal) {
            const data = groupedByRemnantGlobal[remId];
            const rem = data.remData;
            totalAsignados += data.blocks.length;
            
            let totalUsedArea = data.blocks.reduce((acc, b) => acc + (b.req_w * b.req_c), 0);
            let remArea = rem.width * rem.cells;
            let scrapArea = remArea - totalUsedArea;
            let utilPct = ((totalUsedArea / remArea) * 100).toFixed(1);
            let scrapBadgeClass = utilPct >= 80 ? 'good' : (utilPct >= 50 ? '' : 'bad');
            
            let html = `
                <div class="map-card success">
                    <div class="map-header">
                        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:8px;">
                            <strong>ID: ${rem.id}</strong>
                            <span style="background:#e0f2fe; color:#0369a1; padding:3px 8px; border-radius:15px; font-size:11px; font-weight:bold; border:1px solid #bae6fd;">📍 ${rem.location || 'PISO'}</span>
                        </div>
                        <div style="line-height: 1.4;">
                            <span class="text-sm">TELA (PCN): <b>${rem.pcn}</b></span><br>
                            <span class="text-sm">LOTE: <b>${data.assigned_batch}</b></span><br>
                            <span class="text-sm" style="color:var(--primary); font-weight:bold;">
                                DIMENSIONES: ${rem.width}W x ${rem.cells}C
                            </span>
                            <div class="scrap-badge ${scrapBadgeClass}" style="margin-top:8px;">
                                Utilización: ${utilPct}% | Scrap: ${scrapArea.toFixed(2)} uds²
                            </div>
                        </div>
                    </div>
                    <div class="fabric-container">
            `;

            // Renderizado de cortes y offcuts se mantiene igual...
            data.blocks.forEach(b => {
                if(b.fit) {
                    let pctX = (b.fit.x / rem.width) * 100, pctY = (b.fit.y / rem.cells) * 100;
                    let pctW = (b.req_w / rem.width) * 100, pctC = (b.req_c / rem.cells) * 100;
                    html += `<div class="fabric-cut" style="left: ${pctX}%; top: ${pctY}%; width: ${pctW}%; height: ${pctC}%;"><span>${b.shop_floor_id.slice(-5)}</span></div>`;
                }
            });

            let relatedOffcuts = finalOffcutsGlobal.filter(o => o.parent_rem === remId);
            relatedOffcuts.forEach(off => {
                let pX = (off.x / rem.width) * 100, pY = (off.y / rem.cells) * 100, pW = (off.width / rem.width) * 100, pC = (off.cells / rem.cells) * 100;
                html += `<div class="fabric-offcut" style="left: ${pX}%; top: ${pY}%; width: ${pW}%; height: ${pC}%;"><span>NUEVO<br>${off.new_id.split('-')[1]}</span></div>`;
            });

            html += `</div></div>`;
            mapsContainer.innerHTML += html;
        }


        if (unassignedGlobal.length > 0) {
            let errorHtml = `<div class="map-card error" style="grid-column: 1 / -1;"><div class="map-header"><strong>Piezas No Asignadas</strong><p class="text-sm text-muted">Forzar asignación.</p></div><div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border); padding: 10px; margin-bottom: 10px;">`;
            unassignedGlobal.forEach((u, index) => {
                errorHtml += `<label style="display: block; margin-bottom: 8px; cursor: pointer;"><input type="checkbox" class="manual-assign-checkbox" value="${index}"> SFID: <b>${u.shop_floor_id}</b> | PCN: ${u.fabric_pcn} | Req: W:${u.req_w} C:${u.req_c}</label>`;
            });
            let options = dbRemanentes.map(r => `<option value="${r.id}">${r.id} | PCN: ${r.pcn} | W:${r.width} C:${r.cells}</option>`).join('');
            errorHtml += `</div><div style="display:flex; gap:10px;"><select id="manual-remnant-select" style="flex:1;"><option value="">-- Selecciona Remanente Destino --</option>${options}</select><button class="btn-primary" onclick="forzarAsignacion()" style="width:auto;">Forzar Asignación</button></div></div>`;
            mapsContainer.innerHTML += errorHtml;
        }

        summaryText.innerHTML = `<strong>Resumen:</strong> ${flatOrdersGlobal.length} órdenes. ${totalAsignados} asignadas.`;
    }

    window.forzarAsignacion = () => {
        const checkboxes = document.querySelectorAll('.manual-assign-checkbox:checked');
        const selectedRemId = document.getElementById('manual-remnant-select').value;
        if (checkboxes.length === 0 || !selectedRemId) return alert("Selecciona piezas y un destino.");

        let targetRemData = dbRemanentes.find(r => r.id === selectedRemId);
        if(!targetRemData) return alert("Remanente no válido.");

        let indexes = Array.from(checkboxes).map(cb => parseInt(cb.value)).sort((a,b) => b-a);
        let piecesToMove = [];
        indexes.forEach(idx => { piecesToMove.push(unassignedGlobal[idx]); unassignedGlobal.splice(idx, 1); });

        if (!groupedByRemnantGlobal[selectedRemId]) {
            groupedByRemnantGlobal[selectedRemId] = { remData: targetRemData, blocks: [], assigned_batch: piecesToMove[0].batch_id, packer: new Packer(targetRemData.width, targetRemData.cells) };
        }

        let group = groupedByRemnantGlobal[selectedRemId];
        group.blocks = group.blocks.concat(piecesToMove);
        group.blocks.sort((a, b) => b.area - a.area);
        
        let newPacker = new Packer(targetRemData.width, targetRemData.cells);
        newPacker.fit(group.blocks);
        group.packer = newPacker;

        buildFinalData(); render2DMaps();
    };

    if (btnViewPdf) {
        btnViewPdf.addEventListener('click', () => {
            const printWindow = window.open('', '_blank');
            const mapsHTML = document.getElementById('maps-container').innerHTML;
            
            const printStyles = `
                <style>
                    body { font-family: sans-serif; padding: 0; margin: 0; background: #f3f4f6; }
                    .grid-maps { display: block; }
                    .map-card { background: white; border: 2px solid #000; padding: 40px; margin: 20px auto; width: 100%; max-width: 800px; box-sizing: border-box; page-break-after: always; }
                    .map-card:last-child { page-break-after: auto; }
                    .map-header { border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; font-size: 18px; }
                    .text-sm { font-size: 14px; color: #333; }
                    .scrap-badge { display: inline-block; padding: 5px 10px; border: 1px solid #000; font-size: 14px; margin-top: 10px; font-weight: bold; }
                    .sfid-list { display: block !important; margin-top: 15px; font-size: 14px; color: #000; border: 1px dashed #666; padding: 10px; }
                    .fabric-container { position: relative; background: #fff; width: 100%; aspect-ratio: 1/1; border: 3px solid #000; margin-top: 20px; }
                    .fabric-cut { position: absolute; background: #e5e7eb; border: 2px solid #000; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; text-align:center; overflow:hidden; }
                    .fabric-offcut { position: absolute; background: rgba(16, 185, 129, 0.4); border: 1px dashed #059669; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; }
                    @media print { body { background: white; } .map-card { border: none; padding: 0; margin: 0; width: 100%; max-width: 100%; } @page { margin: 1.5cm; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
                </style>
            `;
            
            printWindow.document.write(`<html><head><title>Hojas de Corte - Producción</title>${printStyles}</head><body><div class="grid-maps">${mapsHTML}</div><script>setTimeout(() => window.print(), 800);</script></body></html>`);
            printWindow.document.close();
        });
    }

    if (btnSaveBatch) {
        btnSaveBatch.addEventListener('click', async () => {
            if (!confirm(`Se guardarán las órdenes.\n¿Continuar?`)) return;
            showLoading('Guardando base de datos...');
            btnSaveBatch.disabled = true;

            // PREPARAR DATOS DEL HISTORIAL
            let historyLogs = [];
            for (let remId in groupedByRemnantGlobal) {
                let group = groupedByRemnantGlobal[remId];
                let remArea = group.remData.width * group.remData.cells;
                let usedArea = group.blocks.reduce((acc, b) => acc + (b.req_w * b.req_c), 0);
                historyLogs.push({
                    batch_id: group.assigned_batch, rem_id: remId, pcn: group.remData.pcn, piezas: group.blocks.length,
                    area_total: remArea, area_usada: usedArea, utilizacion: ((usedArea / remArea) * 100).toFixed(2)
                });
            }

            try {
                const response = await fetch(APPS_SCRIPT_URL, { 
                    method: 'POST', body: JSON.stringify({ action: 'saveMassiveOrders', payload: { orders: flatOrdersGlobal, offcuts: finalOffcutsGlobal, history: historyLogs } }) 
                });
                const result = await response.json();
                
                if (result.status === 'success') {
                    alert(result.message);
                    excelDataArea.value = ''; previewSection.classList.add('hidden');
                    if(btnViewPdf) btnViewPdf.classList.add('hidden');
                } else { alert("Error: " + result.message); }
            } catch (error) { alert("Error de conexión."); } 
            finally { hideLoading(); btnSaveBatch.disabled = false; }
        });
    }

    // === MÓDULO 2 Y 3: CARGA DE ASIGNACIÓN ===
    async function loadBatches() {
        const batchGrid = document.getElementById('batch-grid'); 
        const selectReasignar = document.getElementById('select-batch-reasignar'); 
        if(batchGrid) batchGrid.innerHTML = '<p class="text-muted">Cargando...</p>';
        selectedBatches = []; checkAssignReady();
        showLoading('Actualizando lotes...');

        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getBatches' }) });
            const result = await response.json();
            
            if(batchGrid) {
                batchGrid.innerHTML = '';
                if(result.data.unassigned.length === 0) batchGrid.innerHTML = '<p class="text-muted">No hay batches pendientes.</p>';
                else result.data.unassigned.forEach(b => {
                    const div = document.createElement('div');
                    div.className = 'interactive-card batch-card'; div.dataset.id = b;
                    div.innerHTML = `<strong>${b}</strong><br><span class="text-sm">Pendiente</span>`;
                    batchGrid.appendChild(div);
                });
            }
            if(selectReasignar) selectReasignar.innerHTML = result.data.assigned.length ? result.data.assigned.map(b => `<option value="${b}">${b}</option>`).join('') : '<option value="">Sin batches asignados</option>';
        } catch (e) { if(batchGrid) batchGrid.innerHTML = '<p style="color:red">Error cargando batches.</p>'; } 
        finally { hideLoading(); }
    }

    const btnEjecutarAsignar = document.getElementById('btn-execute-asignar');
    if (btnEjecutarAsignar) {
        btnEjecutarAsignar.addEventListener('click', async () => {
            if (selectedBatches.length === 0 || !selectedPicker) return;
            showLoading(`Asignando lote(s)...`);
            try {
                const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'assignBatch', payload: { batch_ids: selectedBatches, picker: selectedPicker } }) });
                const result = await response.json();
                alert(result.message);
                selectedBatches = []; selectedPicker = null; document.querySelectorAll('.interactive-card').forEach(c => c.classList.remove('selected'));
                loadBatches(); 
            } catch (error) { alert("Error."); } finally { hideLoading(); }
        });
    }

    window.ejecutarReasignacion = async () => {
        const batchVal = document.getElementById('select-batch-reasignar').value; const pickerVal = document.getElementById('select-picker-re').value;
        const btn = document.getElementById('btn-execute-reasignar');
        if(!batchVal || !pickerVal) return; showLoading('Re-asignando...'); btn.disabled = true;
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'assignBatch', payload: { batch_ids: [batchVal], picker: pickerVal } }) });
            const result = await response.json(); alert(result.message); loadBatches();
        } catch (error) { alert("Error."); } finally { hideLoading(); btn.disabled = false; }
    };
});
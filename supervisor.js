document.addEventListener('DOMContentLoaded', () => {
    // === CONTROL DE ACCESO ===
    const userSession = JSON.parse(sessionStorage.getItem('userSession'));
    if (!userSession || userSession.role.toLowerCase() !== 'supervisor') {
        window.location.href = 'login.html';
        return;
    }

    const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwzjthPZvtAH-R_H1h5GNMe0p5-8ofbODHenwXBHTmRArn_phXq8lwbwRq28s3_iO11/exec'; 

    const navButtons = document.querySelectorAll('.nav-btn');
    const panels = document.querySelectorAll('.panel');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    function showLoading(text) { loadingText.textContent = text; loadingOverlay.classList.remove('hidden'); }
    function hideLoading() { loadingOverlay.classList.add('hidden'); }

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.add('hidden'));
            btn.classList.add('active');
            document.getElementById(btn.getAttribute('data-target')).classList.remove('hidden');
        });
    });

    document.getElementById('logout-btn').addEventListener('click', () => { 
        sessionStorage.removeItem('userSession');
        window.location.href = 'login.html'; 
    });

    async function loadSupervisorData() {
        showLoading("Sincronizando datos...");
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'getSupervisorData' }) });
            const result = await response.json();
            
            // 1. Scrap
            document.getElementById('dash-scrap-pct').textContent = result.data.scrap + '%';

            // 2. Pickers Activos
            const dash = document.getElementById('pickers-dashboard');
            dash.innerHTML = '';
            if(result.data.pickerStats.length === 0) {
                dash.innerHTML = '<p class="text-muted">No hay pickers con actividad.</p>';
            } else {
                result.data.pickerStats.forEach(p => {
                    dash.innerHTML += `
                        <div class="map-card success" style="text-align:center;">
                            <h3 style="color:var(--primary); font-size:1.5rem; margin-bottom:0.5rem;">${p.picker}</h3>
                            <div class="text-muted">Batches Asignados</div>
                            <div style="font-size:2.5rem; font-weight:bold;">${p.batchCount}</div>
                        </div>`;
                });
            }

            // 3. Familias
            const tbody = document.querySelector('#tabla-condiciones tbody');
            tbody.innerHTML = '';
            result.data.condiciones.forEach(c => {
                let shortPcn = c.pcns.length > 20 ? c.pcns.substring(0, 20) + '...' : c.pcns;
                tbody.innerHTML += `
                    <tr>
                        <td><strong>${c.familia}</strong><br><span style="font-size:10px; color:gray">${shortPcn}</span></td>
                        <td>W: ±${c.tol_width} | C: +${c.tol_cells}</td>
                        <td><button class="btn-secondary" onclick="editarFamilia('${c.familia}', ${c.min_width}, ${c.min_cells}, ${c.tol_width}, ${c.tol_cells}, '${c.pcns}')" style="padding: 0.3rem 0.6rem; font-size:0.8rem;">Editar</button></td>
                    </tr>`;
            });

            // 4. Auditoría de Pre-Altas
            const panelAuditoria = document.getElementById('auditoria-list'); // Crear un div con este ID en el HTML si deseas verlo
            if(panelAuditoria) {
                panelAuditoria.innerHTML = `<h3>Sobrantes Pendientes de Alta en Piso: ${result.data.preAltas.length}</h3>`;
                result.data.preAltas.forEach(pa => {
                    panelAuditoria.innerHTML += `<div class="card mb-1"><strong>${pa.id}</strong> | PCN: ${pa.pcn} | W:${pa.w} C:${pa.c}</div>`;
                });
            }

            // 5. Historial de Optimización
            const panelHist = document.getElementById('historial-list'); // Crear un div con este ID en el HTML si deseas verlo
            if(panelHist) {
                panelHist.innerHTML = '';
                result.data.history.forEach(h => {
                    panelHist.innerHTML += `
                        <tr>
                            <td>${h.batch}</td>
                            <td>${h.rem_id}</td>
                            <td>${h.pcn}</td>
                            <td>${h.uso}%</td>
                        </tr>`;
                });
            }

        } catch (error) { alert("Error cargando panel."); }
        finally { hideLoading(); }
    }

    document.getElementById('btn-refresh-dash').addEventListener('click', loadSupervisorData);
    
    document.getElementById('form-condicion').addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            familia: document.getElementById('cond-fam').value,
            min_width: parseFloat(document.getElementById('cond-min-w').value),
            min_cells: parseInt(document.getElementById('cond-min-c').value),
            tol_width: parseFloat(document.getElementById('cond-tol-w').value),
            tol_cells: parseInt(document.getElementById('cond-tol-c').value),
            pcns: document.getElementById('cond-pcns').value
        };

        showLoading("Guardando regla...");
        try {
            const response = await fetch(APPS_SCRIPT_URL, { method: 'POST', body: JSON.stringify({ action: 'saveCondition', payload: payload }) });
            const result = await response.json();
            alert(result.message); document.getElementById('form-condicion').reset(); loadSupervisorData();
        } catch (error) { alert("Error."); } finally { hideLoading(); }
    });

    window.editarFamilia = (fam, mw, mc, tw, tc, pcns) => {
        document.getElementById('cond-fam').value = fam; document.getElementById('cond-min-w').value = mw;
        document.getElementById('cond-min-c').value = mc; document.getElementById('cond-tol-w').value = tw;
        document.getElementById('cond-tol-c').value = tc; document.getElementById('cond-pcns').value = pcns;
        window.scrollTo(0, 0); 
    };

    loadSupervisorData();
});
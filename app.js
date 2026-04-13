document.addEventListener('DOMContentLoaded', () => {
    // Referencias DOM principales
    const loginView = document.getElementById('login-view');
    const optimizadorView = document.getElementById('optimizador-view');
    const loginForm = document.getElementById('login-form');
    const logoutBtn = document.getElementById('logout-btn');
    
    // Navegación Sidebar Optimizador
    const navButtons = document.querySelectorAll('.nav-btn');
    const panels = document.querySelectorAll('.panel');

    // MÓDULO: Autenticación (Simulada)
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const role = document.getElementById('role').value;
        
        // Solo habilitado optimizador para esta fase
        if (role === 'optimizador') {
            loginView.classList.add('hidden');
            optimizadorView.classList.remove('hidden');
        }
    });

    logoutBtn.addEventListener('click', () => {
        optimizadorView.classList.add('hidden');
        loginView.classList.remove('hidden');
        loginForm.reset();
    });

    // MÓDULO: Navegación Optimizador
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Limpiar activos
            navButtons.forEach(b => b.classList.remove('active'));
            panels.forEach(p => p.classList.add('hidden'));

            // Activar seleccionado
            btn.classList.add('active');
            const targetId = btn.getAttribute('data-target');
            document.getElementById(targetId).classList.remove('hidden');
        });
    });

    // MÓDULO: Simulación de Optimización
    const formOptimizar = document.getElementById('form-optimizar');
    const resultsContainer = document.getElementById('optimization-results');

    formOptimizar.addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Aquí se conectará la lógica real (evaluación de condiciones SANS, etc.)
        // y la búsqueda en base de datos.
        
        // Simulación de visualización de resultados
        document.getElementById('res-rem').textContent = 'REM-98273 (W:33, C:45)';
        document.getElementById('res-used').textContent = 'W:30, C:40';
        document.getElementById('res-scrap').textContent = '3 width, 5 cells';
        
        resultsContainer.classList.remove('hidden');
        alert("Simulación de optimización ejecutada. Revisa los resultados y el mapa.");
    });
});
/**
 * Common Initialization Script
 * Añadir este script a todas las páginas que requieren autenticación
 * 
 * Uso:
 * <script src="js/common-init.js"></script>
 * <script>
 *   initPage({ requireAuth: true, requireRole: 'estudiante' });
 * </script>
 */

// Asegurar que los scripts necesarios estén cargados
function ensureScriptsLoaded() {
    return new Promise((resolve) => {
        // Verificar si StellarSdk está cargado
        if (typeof StellarSdk === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/11.2.2/stellar-sdk.min.js';
            script.onload = () => {
                if (typeof window.walletManager === 'undefined' && typeof StellarSdk !== 'undefined') {
                    // Cargar wallet-manager si no está cargado
                    const wmScript = document.createElement('script');
                    wmScript.src = 'js/wallet-manager.js';
                    wmScript.onload = resolve;
                    document.head.appendChild(wmScript);
                } else {
                    resolve();
                }
            };
            document.head.appendChild(script);
        } else {
            resolve();
        }
    });
}

// Inicializar página con validación de sesión
function initPage(options = {}) {
    const {
        requireAuth = true,
        requireRole = null,
        redirectIfRole = null,
        redirectIfRoleTo = null
    } = options;

    // Esperar a que el DOM esté listo
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            ensureScriptsLoaded().then(() => {
                validateAndInit();
            });
        });
    } else {
        ensureScriptsLoaded().then(() => {
            validateAndInit();
        });
    }

    function validateAndInit() {
        // Validar sesión si se requiere
        if (requireAuth) {
            if (typeof window.authManager !== 'undefined') {
                const isValid = window.authManager.validateSession({
                    requireAuth: true,
                    redirectTo: 'index.html',
                    requireRole: requireRole,
                    redirectIfRole: redirectIfRole,
                    redirectIfRoleTo: redirectIfRoleTo
                });
                if (!isValid) return;
            } else {
                // Fallback sin auth-manager
                const currentUserStr = sessionStorage.getItem('currentUser');
                if (!currentUserStr) {
                    alert('Por favor, inicia sesión para acceder a esta página.');
                    window.location.href = 'index.html';
                    return;
                }
                
                try {
                    const currentUser = JSON.parse(currentUserStr);
                    if (requireRole && currentUser.role !== requireRole) {
                        alert(`Esta página es solo para ${requireRole === 'docente' ? 'docentes' : 'estudiantes'}.`);
                        window.location.href = 'Inicio.html';
                        return;
                    }
                } catch (e) {
                    window.location.href = 'index.html';
                    return;
                }
            }
        }

        // Página inicializada correctamente
        console.log('Página inicializada correctamente');
    }
}

// Exportar función global
window.initPage = initPage;


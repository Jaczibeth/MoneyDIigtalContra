/**
 * Auth Manager - Gestión centralizada de autenticación y sesión
 * Valida sesiones y gestiona roles de usuario
 */

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.loadUser();
    }

    /**
     * Carga el usuario desde localStorage
     */
    loadUser() {
        try {
            const userStr = localStorage.getItem('currentUser');
            if (userStr) {
                this.currentUser = JSON.parse(userStr);
                return this.currentUser;
            }
        } catch (e) {
            console.warn('Error cargando usuario:', e);
            this.logout();
        }
        return null;
    }

    /**
     * Verifica si hay una sesión activa
     */
    isAuthenticated() {
        return !!this.currentUser;
    }

    /**
     * Obtiene el usuario actual
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Obtiene el rol del usuario
     */
    getRole() {
        return this.currentUser?.role || 'estudiante';
    }

    /**
     * Verifica si el usuario es docente
     */
    isTeacher() {
        return this.getRole() === 'docente';
    }

    /**
     * Verifica si el usuario es estudiante
     */
    isStudent() {
        return this.getRole() === 'estudiante';
    }

    /**
     * Obtiene el nombre de usuario
     */
    getUsername() {
        return this.currentUser?.username || 'Usuario';
    }

    /**
     * Obtiene el email del usuario
     */
    getEmail() {
        return this.currentUser?.email || '';
    }

    /**
     * Obtiene la clave pública Stellar del usuario
     */
    getStellarPublicKey() {
        return this.currentUser?.stellarPublic || null;
    }

    /**
     * Inicia sesión
     */
    login(userData) {
        this.currentUser = {
            username: userData.username,
            email: userData.email,
            role: userData.role || 'estudiante',
            stellarPublic: userData.stellarPublic || null
        };
        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
    }

    /**
     * Cierra sesión
     */
    logout() {
        this.currentUser = null;
        localStorage.removeItem('currentUser');
    }

    /**
     * Actualiza los datos del usuario
     */
    updateUser(updates) {
        if (!this.currentUser) return;
        
        this.currentUser = {
            ...this.currentUser,
            ...updates
        };
        localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
    }

    /**
     * Valida la sesión y redirige si es necesario
     * @param {Object} options - Opciones de validación
     * @param {boolean} options.requireAuth - Si requiere autenticación (default: true)
     * @param {string} options.redirectTo - URL a la que redirigir si no hay sesión
     * @param {string} options.requireRole - Rol requerido ('docente' o 'estudiante')
     * @param {string} options.redirectIfRole - Redirigir si tiene este rol
     * @param {string} options.redirectIfRoleTo - URL a la que redirigir si tiene el rol
     */
    validateSession(options = {}) {
        const {
            requireAuth = true,
            redirectTo = 'Index.html',
            requireRole = null,
            redirectIfRole = null,
            redirectIfRoleTo = null
        } = options;

        // Si requiere autenticación y no hay sesión
        if (requireAuth && !this.isAuthenticated()) {
            alert('Por favor, inicia sesión para acceder a esta página.');
            window.location.href = redirectTo;
            return false;
        }

        // Si requiere un rol específico
        if (requireRole && this.getRole() !== requireRole) {
            alert(`Esta página es solo para ${requireRole === 'docente' ? 'docentes' : 'estudiantes'}.`);
            window.location.href = 'Inicio.html';
            return false;
        }

        // Si debe redirigir por rol
        if (redirectIfRole && this.getRole() === redirectIfRole && redirectIfRoleTo) {
            window.location.href = redirectIfRoleTo;
            return false;
        }

        return true;
    }

    /**
     * Inicializa la validación de sesión en una página
     * Añade un script que valida automáticamente al cargar
     */
    static initPageValidation(options = {}) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                const auth = new AuthManager();
                auth.validateSession(options);
            });
        } else {
            const auth = new AuthManager();
            auth.validateSession(options);
        }
    }

    /**
     * Muestra información del usuario en un elemento del DOM
     */
    displayUserInfo(elementId) {
        const element = document.getElementById(elementId);
        if (element && this.currentUser) {
            const roleText = this.isTeacher() ? '👨‍🏫 Docente' : '🎓 Estudiante';
            element.textContent = `👤 ${this.getUsername()} | ${roleText}`;
        }
    }
}

// Crear instancia global
window.authManager = new AuthManager();

// Función helper para validación rápida
window.validateAuth = (options) => {
    return window.authManager.validateSession(options);
};



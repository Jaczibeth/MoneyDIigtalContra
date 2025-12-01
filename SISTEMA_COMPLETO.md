# 🎯 Sistema Completo de Actividades y Recompensas - Money Digital

## ✅ Sistema Implementado

### 📁 Archivos Creados

#### JavaScript Core
- **`docs/js/activities-system.js`** - Sistema completo de gestión de actividades, submissions, tokens y recompensas
- **`docs/js/file-upload.js`** - Sistema de subida y gestión de archivos/evidencias
- **`docs/js/stellar-integration.js`** - Integración con Stellar Wallet para transferir tokens

#### Páginas para Estudiantes
- **`docs/actividades-estudiante.html`** - Ver actividades, subir evidencia, enviar para revisión
- **`docs/recompensas.html`** - Ver recompensas disponibles y canjear con tokens
- **`docs/historial-estudiante.html`** - Historial completo de actividades, tokens y recompensas

#### Páginas para Docentes
- **`docs/gestion-actividades.html`** - Crear, editar y gestionar actividades
- **`docs/revision-actividades.html`** - Revisar evidencias, aprobar/rechazar, otorgar tokens
- **`docs/gestion-recompensas.html`** - Crear y gestionar recompensas
- **`docs/progreso-estudiantes.html`** - Ver progreso y rendimiento de estudiantes
- **`docs/historial-docente.html`** - Historial general de actividades aprobadas y tokens entregados

### 🔄 Flujo Completo del Sistema

#### Para Estudiantes:

1. **Ver Actividades** (`actividades-estudiante.html`)
   - Lista de actividades asignadas por el docente
   - Ver detalles: título, descripción, tokens, fecha límite
   - Estado: Pendiente, Enviada, Aprobada, Rechazada
   - Subir evidencia (PDF, imagen, video)
   - Enviar para revisión
   - Ver comentarios del docente

2. **Recibir Tokens**
   - Automáticamente cuando el docente aprueba
   - Se transfieren a la wallet Stellar del estudiante
   - Se guardan también localmente para canjear recompensas

3. **Canjear Recompensas** (`recompensas.html`)
   - Ver recompensas disponibles
   - Ver costo en tokens
   - Canjear si tiene suficientes tokens

4. **Ver Historial** (`historial-estudiante.html`)
   - Actividades enviadas
   - Actividades aprobadas
   - Tokens recibidos por cada actividad
   - Recompensas canjeadas

#### Para Docentes:

1. **Crear Actividades** (`gestion-actividades.html`)
   - Título, descripción, tokens a otorgar
   - Fecha límite, materia, instrucciones
   - Ver todas las actividades creadas
   - Editar o desactivar actividades

2. **Revisar Evidencias** (`revision-actividades.html`)
   - Ver todas las evidencias enviadas
   - Filtrar por estado (pendiente, aprobada, rechazada)
   - Ver archivo subido por el estudiante
   - Aprobar → Otorga tokens automáticamente
   - Rechazar → Con comentarios
   - Necesita Corrección → Para que el estudiante mejore

3. **Ver Progreso** (`progreso-estudiantes.html`)
   - Lista de estudiantes
   - Actividades completadas por cada uno
   - Tokens acumulados
   - Rendimiento general

4. **Gestionar Recompensas** (`gestion-recompensas.html`)
   - Crear nuevas recompensas
   - Ver cuántas han sido canjeadas
   - Activar/desactivar recompensas

### 🔗 Integración con Wallet Stellar

- **Transferencia Automática**: Cuando un docente aprueba una actividad, los tokens se transfieren automáticamente a la wallet Stellar del estudiante
- **Conversión**: 1 token del sistema = 0.1 XLM (ajustable)
- **Soporte Freighter**: Usa Freighter Wallet si está disponible, o clave secreta como fallback
- **Registro de Transacciones**: Se guarda el hash de la transacción en el historial

### 📊 Dashboard Diferenciado

El dashboard (`Inicio.html`) muestra diferentes vistas según el rol:

**Estudiante:**
- Actividades pendientes
- Actividades enviadas
- Tokens disponibles
- Actividades aprobadas
- Barra de progreso

**Docente:**
- Estudiantes activos
- Pendientes de revisar
- Tokens otorgados
- Actividades creadas

### 🎁 Sistema de Recompensas

- Los docentes crean recompensas con costo en tokens
- Los estudiantes pueden canjear recompensas con sus tokens
- Se registra cada canje en el historial
- Los tokens se descuentan del balance del estudiante

### 📝 Características Técnicas

- **Almacenamiento**: localStorage (en producción usar backend)
- **Subida de Archivos**: Base64 en localStorage (en producción usar servidor)
- **Verificación de Sesión**: Todas las páginas verifican sesión
- **Roles**: Sistema completo de roles (estudiante/docente)
- **Estados de Actividades**: pending, submitted, approved, rejected, needs_correction

### 🚀 Cómo Usar

1. **Registrarse**: Crear cuenta como estudiante o docente
2. **Docente crea actividad**: Con tokens a otorgar
3. **Estudiante ve actividad**: En su lista de actividades
4. **Estudiante sube evidencia**: Archivo + comentarios
5. **Docente revisa**: Aprobar/rechazar/corrección
6. **Si se aprueba**: Tokens se transfieren automáticamente a wallet Stellar
7. **Estudiante canjea**: Usa tokens para recompensas
8. **Ver historial**: Tanto estudiantes como docentes pueden ver historial completo

### ⚠️ Notas Importantes

- Los tokens se otorgan automáticamente al aprobar (no los decide el estudiante)
- La transferencia a Stellar requiere que el estudiante tenga wallet conectada
- Si no hay wallet, los tokens se guardan solo localmente
- El sistema funciona completamente offline con localStorage
- En producción, mover a backend con base de datos real

---

**Sistema completamente funcional y listo para usar! 🎉**


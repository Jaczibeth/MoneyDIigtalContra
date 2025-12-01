# MONEY-DIGITAL

## Acuerdo de Compromiso del Equipo

Este documento describe el acuerdo de compromiso del equipo para el proyecto **MONEY-DIGITAL**, detallando el alcance del proyecto, los entregables, las responsabilidades, los plazos y el proceso de firma digital.

---

## 1. Alcance del Proyecto

### 1.1 Descripción General

**MONEY-DIGITAL** es una plataforma de dinero digital basada en la blockchain de Stellar y contratos inteligentes de Soroban. El proyecto está enfocado en **promover la participación de jóvenes en actividades extracurriculares** mediante un sistema de recompensas digitales. 

**GROUP JAD - Dinero Inteligente, Futuro Brillante**

Somos una empresa enfocada en promover la participación de jóvenes llenos de talento en actividades extracurriculares dentro de su alma mater, incentivándolos en una sana competencia con la finalidad de obtener recompensas digitales que les brindarán apoyo en su formación académica.

El proyecto integra un sistema educativo (Academy) con un ecosistema de tokens digitales, permitiendo la gestión de estudiantes, docentes, actividades extracurriculares, materias, certificados y transacciones financieras mediante tecnología blockchain.

### 1.2 Objetivos Principales

- **Actividades Extracurriculares**: Sistema completo para gestionar y promover la participación en actividades extracurriculares (hackathons, clubes, competencias, voluntariado, etc.)
- **Sistema de Recompensas Digitales**: Implementación de tokens digitales como recompensas por participación en actividades, incentivando la sana competencia entre estudiantes
- **Gestión Educativa**: Sistema completo para administrar estudiantes, docentes, actividades, materias y certificados digitales
- **Ecosistema de Tokens**: Implementación de tokens digitales (XLM y tokens personalizados) para recompensas y transacciones dentro de la plataforma
- **Wallet Integrada**: Interfaz de usuario para gestionar wallets de Stellar, consultar recompensas acumuladas y realizar transacciones
- **Certificados Digitales**: Generación y almacenamiento de certificados de participación y logros en la blockchain
- **Contratos Inteligentes**: Implementación de contratos Soroban para la lógica de negocio, distribución de recompensas y transacciones

### 1.3 Funcionalidades Principales

#### Backend (Contratos Soroban)
- Gestión de estudiantes (registro, búsqueda)
- Gestión de docentes (registro, asignación a materias)
- Gestión de actividades extracurriculares (registro, búsqueda, participación)
- Sistema de recompensas (asignación de tokens por participación y logros)
- Gestión de materias (registro, búsqueda por nombre)
- Gestión de documentos (carga, búsqueda, adquisición)
- Generación de certificados digitales de participación
- Integración con Stellar Network para transacciones de recompensas

#### Frontend (Interfaz Web)
- **Index.html**: Sistema de autenticación e inicio de sesión con Freighter Wallet
- **Inicio.html**: Panel principal con dashboard de actividades extracurriculares y recompensas
- **cursos.html**: Catálogo de actividades extracurriculares disponibles (hackathons, clubes, competencias, etc.)
- **Wallet.html**: Gestión de wallet Stellar, consulta de recompensas acumuladas y transferencias
- **Moneda.html**: Información sobre tokens y recompensas digitales, conversión de divisas
- **materias.html**: Gestión de materias por niveles educativos
- **niveles.html**: Sistema de niveles y progreso académico basado en participación
- **cetificado.html**: Visualización y gestión de certificados digitales de participación y logros
- **Usuarios.html**: Administración de usuarios del sistema (estudiantes, docentes)
- **Register.html**: Registro de nuevos usuarios

---

## 2. Entregables

### 2.1 Contratos Inteligentes (Soroban)

- [x] Contrato principal `money-digital` con las siguientes funcionalidades:
  - Gestión de estudiantes (`insert_estudiante`, `buscar_estudiantes`)
  - Gestión de docentes (`insert_docente`)
  - Gestión de actividades extracurriculares (`registrar`, `buscar_cursos`)
  - Sistema de recompensas (asignación de tokens por participación)
  - Gestión de documentos (`cargar_documento`, `buscar_documento`, `adquirir_documento`)
  - Gestión de materias (`registrar_materia`, `buscar_materia`)
  - Generación de certificados digitales (`generar_certificado`)

### 2.2 Interfaz de Usuario (Frontend)

- [x] Sistema de autenticación con Freighter Wallet
- [x] Panel principal con dashboard de actividades y recompensas
- [x] Interfaz de gestión de wallet y recompensas acumuladas
- [x] Catálogo de actividades extracurriculares con sistema de participación
- [x] Sistema de recompensas digitales por participación
- [x] Gestión de materias y niveles educativos
- [x] Visualización de certificados digitales de participación y logros
- [x] Sistema de registro de usuarios

### 2.3 Integración con Stellar

- [x] Integración con Freighter Wallet API
- [x] Conexión a Stellar Testnet
- [x] Sistema de transferencias de XLM
- [x] Consulta de balances y transacciones
- [x] Gestión de claves públicas y privadas

### 2.4 Documentación

- [x] README.md con documentación completa del proyecto
- [x] Estructura del proyecto documentada
- [x] Instrucciones de instalación y despliegue
- [x] Guía de uso de la plataforma

---

## 3. Responsabilidades del Equipo

### 3.1 Líder del Proyecto
- **Responsable**: Jaczibeth
- **Responsabilidades**:
  - Coordinación general del proyecto
  - Revisión y aprobación de cambios (Pull Requests)
  - Gestión de la documentación del proyecto
  - Validación de entregables

### 3.2 Desarrollador Backend
- **Responsabilidades**:
  - Desarrollo de contratos inteligentes en Soroban
  - Implementación de la lógica de negocio
  - Testing de contratos
  - Optimización de código Rust

### 3.3 Desarrollador Frontend
- **Responsabilidades**:
  - Desarrollo de interfaces de usuario (HTML/CSS/JavaScript)
  - Integración con Freighter Wallet
  - Integración con contratos Soroban
  - Experiencia de usuario (UX/UI)

### 3.4 Revisor de Código
- **Responsable**: Vanessacruzortiz
- **Responsabilidades**:
  - Revisión de código y Pull Requests
  - Validación de funcionalidades
  - Aprobación de cambios

### 3.5 Equipo de Testing
- **Responsabilidades**:
  - Pruebas de funcionalidad
  - Pruebas de integración
  - Validación de casos de uso
  - Reporte de bugs y mejoras

---

## 4. Plazos

### 4.1 Fase 1: Desarrollo Inicial (Completada)
- **Fecha de inicio**: Noviembre 2024
- **Fecha de finalización**: 24 de Noviembre 2024
- **Entregables**:
  - Contrato base de Soroban
  - Interfaz web básica
  - Integración con Freighter Wallet

### 4.2 Fase 2: Validación #3 (Completada)
- **Fecha**: 24 de Noviembre 2024
- **Entregables**:
  - Documentación completa del proyecto
  - README.md con acuerdo de compromiso
  - Validación y aprobación del proyecto

### 4.3 Fase 3: Desarrollo Continuo (En Progreso)
- **Estado**: Activo
- **Próximos entregables**:
  - Mejoras en la interfaz de usuario
  - Optimización de contratos
  - Nuevas funcionalidades según requerimientos

### 4.4 Fase 4: Despliegue a Producción (Pendiente)
- **Fecha estimada**: Por definir
- **Entregables**:
  - Despliegue en Stellar Mainnet
  - Testing completo en producción
  - Documentación de usuario final

---

## 5. Proceso de Firma Digital

### 5.1 Validación de Cambios

Todos los cambios al proyecto deben seguir el siguiente proceso:

1. **Creación de Pull Request (PR)**
   - El desarrollador crea un PR con los cambios propuestos
   - El PR debe incluir descripción detallada de los cambios
   - Debe estar asociado a un issue o tarea específica

2. **Revisión de Código**
   - El revisor de código (Vanessacruzortiz) revisa los cambios
   - Se valida la funcionalidad y calidad del código
   - Se verifican los tests y la documentación

3. **Aprobación**
   - El revisor aprueba el PR si cumple con los estándares
   - Se puede solicitar cambios si es necesario

4. **Merge**
   - El líder del proyecto (Jaczibeth) realiza el merge
   - Los cambios se integran a la rama principal (`main`)

### 5.2 Firma Digital de Documentos

Para documentos importantes del proyecto (como este README):

1. **Creación del Documento**
   - Se crea o actualiza el documento en el repositorio
   - Se incluye en un Pull Request

2. **Validación**
   - El equipo revisa el contenido
   - Se valida que cumpla con los requisitos

3. **Aprobación Digital**
   - Los revisores aprueban el PR
   - El merge al repositorio actúa como firma digital del acuerdo

4. **Registro en Blockchain (Opcional)**
   - Los documentos importantes pueden ser registrados en la blockchain de Stellar
   - Se genera un hash del documento y se almacena en un contrato Soroban
   - Esto proporciona inmutabilidad y trazabilidad

### 5.3 Validación #3 - Proceso Específico

Para la Validación #3 del proyecto:

- **Fecha de validación**: 24 de Noviembre 2024
- **Documento validado**: README.md con acuerdo de compromiso
- **Aprobado por**: Vanessacruzortiz
- **Merged por**: Jaczibeth
- **Estado**: ✅ Completado y aprobado

---

## 6. Estructura del Proyecto

```
.
├── contracts
│   └── hello-world (money-digital)
│       ├── src
│       │   ├── lib.rs          # Contrato principal
│       │   └── test.rs         # Tests del contrato
│       ├── Cargo.toml
│       └── Makefile
├── docs
│   ├── Index.html              # Autenticación
│   ├── Inicio.html             # Panel principal
│   ├── Wallet.html             # Gestión de wallet
│   ├── Moneda.html             # Información de moneda
│   ├── cursos.html             # Catálogo de cursos
│   ├── materias.html           # Gestión de materias
│   ├── niveles.html            # Sistema de niveles
│   ├── cetificado.html         # Certificados digitales
│   ├── Usuarios.html           # Administración de usuarios
│   ├── Register.html           # Registro de usuarios
│   └── app.js                  # Integración con Soroban y Freighter
├── Cargo.toml                  # Workspace de Rust
├── package.json                # Dependencias Node.js
└── README.md                   # Este documento
```

---

## 7. Configuración e Instalación

### 7.1 Requisitos Previos

- **Rust** (última versión estable)
- **Soroban CLI** instalado
- **Node.js** y npm
- **Freighter Wallet** (extensión del navegador)
- **Target Rust**: `wasm32v1-none` para compilación de contratos

### 7.2 Instalación

1. **Instalar el target de Rust para Soroban**:
```bash
rustup target add wasm32v1-none
```

2. **Clonar el repositorio**:
```bash
git clone https://github.com/SistemasTecTlaxiaco/Money-Digital.git
cd Money-Digital
```

3. **Instalar dependencias**:
```bash
npm install
```

4. **Compilar el contrato**:
```bash
cd contracts/hello-world
make build
```

5. **Desplegar en Testnet**:
```bash
make deploy
```

6. **Actualizar CONTRACT_ID**:
   - Copiar el ID del contrato desplegado
   - Actualizar `CONTRACT_ID` en `docs/app.js`

### 7.3 Uso

1. Abrir `docs/Index.html` en un navegador con Freighter Wallet instalado
2. Conectar la wallet a Stellar Testnet
3. Registrar usuarios, crear cursos y realizar transacciones

---

## 8. Red y Configuración

- **Testnet Horizon**: https://horizon-testnet.stellar.org
- **Soroban RPC Testnet**: https://rpc-testnet.stellar.org
- **Network Passphrase**: Test SDF Network ; September 2015
- **Freighter Network**: Testnet

---

## 9. Licencia y Créditos

Este proyecto es parte del sistema **MONEY-DIGITAL** desarrollado por **SistemasTecTlaxiaco**.

**Equipo de Desarrollo**:
- Jaczibeth (Líder del Proyecto)
- Vanessacruzortiz (Revisora de Código)
- Equipo de Desarrollo Backend y Frontend

---

## 10. Contacto y Soporte

Para consultas, reportes de bugs o sugerencias:
- **Repositorio**: https://github.com/SistemasTecTlaxiaco/Money-Digital
- **Issues**: Utilizar el sistema de Issues de GitHub

---

**Última actualización**: 24 de Noviembre 2024  
**Versión del documento**: 3.0  
**Estado**: ✅ Validado y Aprobado

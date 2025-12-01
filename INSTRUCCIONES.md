# 🚀 Instrucciones para Levantar el Frontend

## Requisitos Previos

- **Node.js** (versión 14 o superior)
- **npm** (viene con Node.js)
- **Freighter Wallet** instalado en tu navegador ([Descargar aquí](https://freighter.app/))

## Pasos para Levantar el Servidor

### 1. Instalar Dependencias

```bash
npm install
```

### 2. Iniciar el Servidor

Tienes dos opciones:

#### Opción A: Usar el servidor personalizado (Recomendado)

```bash
npm start
```

O también puedes usar:

```bash
npm run dev
```

#### Opción B: Usar http-server directamente

```bash
npm run serve
```

### 3. Acceder a la Aplicación

Una vez que el servidor esté corriendo, abre tu navegador y ve a:

```
http://localhost:8080
```

O directamente a la página de inicio:

```
http://localhost:8080/Index.html
```

## Estructura de Páginas

- **Index.html** - Página de inicio de sesión
- **Register.html** - Registro de nuevos usuarios
- **Inicio.html** - Panel principal de la aplicación
- **Wallet.html** - Gestión de wallet Stellar
- **Moneda.html** - Información sobre la moneda digital
- **cursos.html** - Catálogo de cursos
- **materias.html** - Gestión de materias
- **niveles.html** - Sistema de niveles
- **cetificado.html** - Certificados digitales
- **Usuarios.html** - Administración de usuarios

## Configuración de Freighter Wallet

1. Instala la extensión Freighter en tu navegador
2. Crea o importa una cuenta de Stellar Testnet
3. Asegúrate de que Freighter esté configurado para usar **Testnet**
4. Conecta tu wallet desde la aplicación

## Solución de Problemas

### El servidor no inicia

- Verifica que el puerto 8080 no esté en uso
- Puedes cambiar el puerto modificando la variable `PORT` en `server.js` o usando:
  ```bash
  PORT=3000 npm start
  ```

### Error de CORS

- Asegúrate de usar el servidor local (no abrir los archivos directamente)
- El servidor incluye headers CORS apropiados

### Freighter Wallet no se detecta

- Verifica que la extensión esté instalada y activa
- Recarga la página después de instalar Freighter
- Asegúrate de que Freighter esté desbloqueado

## Desarrollo

Para desarrollo continuo, el servidor se reiniciará automáticamente cuando detecte cambios en los archivos.

## Detener el Servidor

Presiona `Ctrl+C` en la terminal donde está corriendo el servidor.


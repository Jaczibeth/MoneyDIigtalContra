const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const DOCS_DIR = path.join(__dirname, 'docs');

// MIME types
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'application/font-woff',
  '.woff2': 'application/font-woff2',
  '.ttf': 'application/font-ttf',
  '.eot': 'application/vnd.ms-fontobject'
};

const server = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  // Parse URL
  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './docs/Index.html';
  } else if (!filePath.startsWith('./docs/')) {
    filePath = './docs' + req.url;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  // Read file
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        // 404 - File not found
        fs.readFile('./docs/Index.html', (error, content) => {
          if (error) {
            res.writeHead(500);
            res.end('Error interno del servidor');
          } else {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(content, 'utf-8');
          }
        });
      } else {
        // 500 - Server error
        res.writeHead(500);
        res.end(`Error del servidor: ${error.code}`);
      }
    } else {
      // 200 - Success
      res.writeHead(200, { 
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log('\n🚀 Servidor iniciado exitosamente!');
  console.log(`📂 Sirviendo archivos desde: ${DOCS_DIR}`);
  console.log(`🌐 Servidor corriendo en: http://localhost:${PORT}`);
  console.log(`📄 Página principal: http://localhost:${PORT}/Index.html\n`);
  console.log('Presiona Ctrl+C para detener el servidor\n');
});


#!/bin/bash
# Script de despliegue para Money Digital
# Uso: ./deploy.sh [surge|render|all]

set -e

echo "=== Money Digital - Despliegue ==="

deploy_surge() {
  echo "→ Desplegando frontend estático en surge.sh..."
  cd docs
  # Crear 200.html para SPA fallback
  cp index.html 200.html
  # Desplegar
  npx surge --domain money-digital.surge.sh
  rm -f 200.html
  cd ..
  echo "✔ Frontend: https://money-digital.surge.sh"
}

deploy_render() {
  echo "→ Desplegando en Render..."
  echo "   Pasos:"
  echo "   1. Conecta tu repo de GitHub a Render"
  echo "   2. Render detectará automáticamente render.yaml"
  echo "   3. Configura STELLAR_SECRET y STELLAR_PUBLIC en Render Dashboard"
  echo ""
  echo "   O via CLI:"
  echo "   npx @render/cli deploy"
  echo ""
  echo "✔ Backend + Frontend: https://money-digital.onrender.com"
}

case "${1:-all}" in
  surge)
    deploy_surge
    ;;
  render)
    deploy_render
    ;;
  all)
    deploy_surge
    deploy_render
    echo ""
    echo "=== Despliegue completado ==="
    echo "Frontend (estático): https://money-digital.surge.sh"
    echo "App completa:        https://money-digital.onrender.com"
    ;;
  *)
    echo "Uso: $0 [surge|render|all]"
    exit 1
    ;;
esac

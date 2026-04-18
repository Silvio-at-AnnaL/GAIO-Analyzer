#!/usr/bin/env bash
# GAIO Analyzer Python — Replit startup
# Builds the React frontend, then serves everything via FastAPI on $PORT.
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT/../gaio-py-frontend"
BACKEND_DIR="$ROOT"
PORT="${PORT:-3000}"

echo "▶ Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install --silent

echo "▶ Building frontend..."
npm run build

echo "▶ Starting Python backend on port $PORT..."
cd "$BACKEND_DIR"
python3 -m uvicorn main:app --host 0.0.0.0 --port "$PORT"

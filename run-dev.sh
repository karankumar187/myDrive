#!/usr/bin/env bash

# Unified Personal Cloud Storage - Local Development Runner
# Starts both Express backend API (port 5001) and React Web Dashboard (port 5173)

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"

echo "======================================================="
echo "   🚀 Starting Unified Personal Cloud Storage"
echo "======================================================="

# Trap Ctrl+C (SIGINT) and kill child processes
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    kill $(jobs -p) 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

# 1. Start Backend API on port 5001
echo "📦 Starting Backend API on http://localhost:5001..."
cd "$DIR/backend"
npm run dev &
BACKEND_PID=$!

# 2. Start Web Dashboard on http://localhost:5173
echo "💻 Starting Web Dashboard on http://localhost:5173..."
cd "$DIR/web"
npm run dev &
WEB_PID=$!

echo ""
echo "✅ Both services are launching!"
echo "👉 Open your browser to: http://localhost:5173"
echo "Press Ctrl+C at any time to stop all services."
echo ""

# Wait for processes
wait

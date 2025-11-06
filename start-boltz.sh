#!/bin/bash

# Start Boltz Backend with Lightning.space infrastructure
# This script prepares LND credentials and starts Boltz

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CONFIG_FILE="$SCRIPT_DIR/boltz-mainnet.conf"
LND_DATA_DIR="$SCRIPT_DIR/.lnd-credentials"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Boltz Backend - Automatischer Start"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 0: Check Docker Services
echo -e "${BLUE}[0/7]${NC} Docker Services überprüfen..."

if ! docker info >/dev/null 2>&1; then
    echo -e "${RED}✗ Docker läuft nicht! Bitte Docker starten.${NC}"
    exit 1
fi

CONTAINERS=("postgres" "redis" "bitcoin-core" "bitcoin-lightning-lnd-1")
for container in "${CONTAINERS[@]}"; do
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        echo -e "${GREEN}✓${NC} $container läuft"
    else
        echo -e "${YELLOW}⚠${NC} $container gestoppt, starte..."
        docker start "$container" >/dev/null 2>&1 || { echo -e "${RED}✗ Fehler beim Start von $container${NC}"; exit 1; }
        echo -e "${GREEN}✓${NC} $container gestartet"
    fi
done

# Wait for services
sleep 3

# Load Bitcoin wallet
echo -e "${BLUE}[0.5/7]${NC} Bitcoin Wallet laden..."
docker exec bitcoin-core bitcoin-cli -rpcuser=dfx -rpcpassword='$trengGehe1m' loadwallet testwallet >/dev/null 2>&1 || echo -e "${YELLOW}⚠${NC} Wallet bereits geladen (OK)"

# Step 1: Copy LND credentials from Docker container
echo -e "${BLUE}[1/7]${NC} LND Credentials kopieren..."
mkdir -p "$LND_DATA_DIR/data/chain/bitcoin/mainnet"

docker cp bitcoin-lightning-lnd-1:/root/.lnd/tls.cert "$LND_DATA_DIR/tls.cert" 2>/dev/null || true
docker cp bitcoin-lightning-lnd-1:/root/.lnd/data/chain/bitcoin/mainnet/admin.macaroon "$LND_DATA_DIR/data/chain/bitcoin/mainnet/admin.macaroon" 2>/dev/null || true

echo -e "${GREEN}✓${NC} LND Credentials kopiert"

# Step 2: Update config file with correct paths
echo -e "${BLUE}[2/7]${NC} Konfiguration aktualisieren..."
sed -i.bak "s|certpath = \"/lnd-data/tls.cert\"|certpath = \"$LND_DATA_DIR/tls.cert\"|g" "$CONFIG_FILE"
sed -i.bak "s|macaroonpath = \"/lnd-data/data/chain/bitcoin/mainnet/admin.macaroon\"|macaroonpath = \"$LND_DATA_DIR/data/chain/bitcoin/mainnet/admin.macaroon\"|g" "$CONFIG_FILE"

echo -e "${GREEN}✓${NC} Konfiguration aktualisiert"

# Step 3: Clean old processes
echo -e "${BLUE}[3/7]${NC} Alte Prozesse beenden..."
pkill -9 boltzd 2>/dev/null || true
pkill -9 boltzr 2>/dev/null || true
sleep 1
echo -e "${GREEN}✓${NC} Prozesse bereinigt"

# Step 4: Check compilation
echo -e "${BLUE}[4/7]${NC} Compilation prüfen..."
if [ ! -f "$SCRIPT_DIR/bin/boltzd" ]; then
    echo -e "${YELLOW}⚠${NC} Boltz noch nicht kompiliert, starte Compilation..."
    npm run compile:release > /tmp/boltz-compile.log 2>&1 || {
        echo -e "${RED}✗ Compilation fehlgeschlagen! Siehe /tmp/boltz-compile.log${NC}"
        exit 1
    }
fi
echo -e "${GREEN}✓${NC} Compilation OK"

# Step 5: Set up environment
echo -e "${BLUE}[5/7]${NC} Umgebung vorbereiten..."
export PATH="$HOME/.cargo/bin:$PATH"
export NODE_ENV=production
echo -e "${GREEN}✓${NC} Umgebung bereit"

# Step 6: Prepare log file
echo -e "${BLUE}[6/7]${NC} Log-Datei vorbereiten..."
> /tmp/boltz-debug.log
echo -e "${GREEN}✓${NC} Log: /tmp/boltz-debug.log"

# Step 7: Start Boltz
echo -e "${BLUE}[7/7]${NC} Boltz Backend starten..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}✓ Boltz Backend wird gestartet...${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Dienste:"
echo "  • API:        http://localhost:9001"
echo "  • gRPC:       localhost:9000"
echo "  • WebSocket:  localhost:9004"
echo "  • Logs:       tail -f /tmp/boltz-debug.log"
echo ""
echo "🔧 Kommandos:"
echo "  • Swap erstellen:  ./create_swap.sh --amount 10000"
echo "  • Logs anzeigen:   tail -f /tmp/boltz-debug.log"
echo "  • Status prüfen:   curl http://localhost:9001/version"
echo ""
echo "Press Ctrl+C to stop"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cd "$SCRIPT_DIR"
node bin/boltzd --configpath "$CONFIG_FILE" 2>&1 | tee /tmp/boltz-debug.log

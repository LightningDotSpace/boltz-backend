#!/bin/bash
#
# Boltz Swap Creator - Bash Version
# Erstellt Reverse Swaps auf lokalem Backend
#

BACKEND_API="http://localhost:9001"
FRONTEND_URL="http://localhost:5173"

# Farben für Output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_help() {
    cat << EOF
Boltz Swap Creator - Bash Version

Verwendung:
  ./create_swap.sh [OPTIONS]

Optionen:
  -h, --help              Zeigt diese Hilfe
  -p, --pairs             Zeigt verfügbare Swap-Paare
  -s, --status SWAP_ID    Prüft Status eines Swaps
  -a, --amount SATS       Betrag in Satoshis (default: 10000)
  -t, --to CURRENCY       Ziel-Währung (default: RBTC)
  -c, --citrea            Erstellt BTC->cBTC Swap (Citrea)
  -r, --rsk               Erstellt BTC->RBTC Swap (RSK) [default]

Beispiele:
  ./create_swap.sh                           # Erstellt BTC->RBTC Swap (10k sats)
  ./create_swap.sh --amount 25000            # Erstellt Swap mit 25k sats
  ./create_swap.sh --citrea                  # Erstellt BTC->cBTC Swap
  ./create_swap.sh --status 3nPGb64LIa8W     # Prüft Swap-Status

EOF
}

# Funktion: Erstelle Reverse Swap
create_reverse_swap() {
    local from="$1"
    local to="$2"
    local amount="$3"
    local description="${4:-Bash test swap}"
    local claim_address="${5:-0xcDc60aD5cEC976c6C04265692d5edAcCc44f95b7}"  # Default RSK address

    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🚀 Erstelle Reverse Swap${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "  From: ${YELLOW}${from}${NC} (Lightning)"
    echo -e "  To:   ${YELLOW}${to}${NC} (Onchain)"
    echo -e "  Amount: ${YELLOW}${amount}${NC} sats"
    echo -e "  Claim Address: ${YELLOW}${claim_address}${NC}"
    echo ""

    # Generiere zufälliges preimageHash (64 hex chars = 32 bytes)
    preimage_hash=$(openssl rand -hex 32)

    # API Request
    response=$(curl -s -X POST "${BACKEND_API}/v2/swap/reverse" \
        -H "Content-Type: application/json" \
        -d "{
            \"from\": \"${from}\",
            \"to\": \"${to}\",
            \"onchainAmount\": ${amount},
            \"claimAddress\": \"${claim_address}\",
            \"preimageHash\": \"${preimage_hash}\",
            \"description\": \"${description}\"
        }")

    # Prüfe auf Fehler
    if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        echo -e "${RED}❌ Fehler beim Erstellen des Swaps:${NC}"
        echo "$response" | jq -r '.error'
        exit 1
    fi

    # Parse Response
    swap_id=$(echo "$response" | jq -r '.id')
    invoice=$(echo "$response" | jq -r '.invoice')
    onchain_amount=$(echo "$response" | jq -r '.onchainAmount')
    timeout=$(echo "$response" | jq -r '.timeoutBlockHeight')

    if [ "$swap_id" = "null" ] || [ -z "$swap_id" ]; then
        echo -e "${RED}❌ Ungültige Response vom Backend:${NC}"
        echo "$response" | jq .
        exit 1
    fi

    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}✅ Swap erfolgreich erstellt!${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "  🆔 Swap ID:              ${YELLOW}${swap_id}${NC}"
    echo -e "  💰 Onchain Amount:       ${YELLOW}${onchain_amount}${NC} sats"
    echo -e "  ⏱️  Timeout Block:        ${YELLOW}${timeout}${NC}"
    echo ""
    echo -e "  ⚡ Lightning Invoice:"
    echo -e "     ${invoice}"
    echo ""
    echo -e "  🌐 Frontend URL:"
    echo -e "     ${FRONTEND_URL}/swap/${swap_id}"
    echo ""
    echo -e "  📋 Status API:"
    echo -e "     ${BACKEND_API}/v2/swap/reverse/${swap_id}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${YELLOW}💡 Nächste Schritte:${NC}"
    echo "   1. Bezahle die Lightning Invoice mit deinem Wallet"
    echo "   2. Warte bis Backend das HTLC empfängt"
    echo "   3. Backend erstellt die Lockup-Transaction"
    echo "   4. Du kannst die Coins mit dem Preimage claimen"
    echo ""

    # Optionales Monitoring
    echo -e "${YELLOW}⏳ Monitoring aktivieren? (y/n)${NC}"
    read -r -t 10 monitor || monitor="n"

    if [ "$monitor" = "y" ] || [ "$monitor" = "Y" ]; then
        monitor_swap "$swap_id"
    fi
}

# Funktion: Monitor Swap Status
monitor_swap() {
    local swap_id="$1"
    local last_status=""

    echo ""
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"
    echo -e "${GREEN}📊 Monitoring Swap Status${NC} (Ctrl+C zum Beenden)"
    echo -e "${BLUE}─────────────────────────────────────────────────────────────${NC}"

    while true; do
        sleep 5
        status_response=$(curl -s "${BACKEND_API}/v2/swap/reverse/${swap_id}")
        current_status=$(echo "$status_response" | jq -r '.status // "unknown"')

        if [ "$current_status" != "$last_status" ]; then
            timestamp=$(date +"%H:%M:%S")
            echo -e "[${timestamp}] 📊 Status: ${YELLOW}${current_status}${NC}"

            # Zeige zusätzliche Infos bei bestimmten Status
            case "$current_status" in
                "transaction.mempool"|"transaction.confirmed")
                    tx_id=$(echo "$status_response" | jq -r '.transaction.id // "N/A"')
                    echo -e "           🔗 Transaction: ${tx_id}"
                    ;;
                "swap.expired"|"invoice.failedToPay")
                    echo -e "           ${RED}❌ Swap fehlgeschlagen!${NC}"
                    break
                    ;;
                "transaction.confirmed")
                    echo -e "           ${GREEN}✅ Swap erfolgreich!${NC}"
                    break
                    ;;
            esac

            last_status="$current_status"
        fi
    done
}

# Funktion: Zeige Swap Status
show_swap_status() {
    local swap_id="$1"

    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}🔍 Swap Status für: ${YELLOW}${swap_id}${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

    response=$(curl -s "${BACKEND_API}/v2/swap/reverse/${swap_id}")

    if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
        echo -e "${RED}❌ Fehler:${NC}"
        echo "$response" | jq -r '.error'
        exit 1
    fi

    echo "$response" | jq .
}

# Funktion: Zeige verfügbare Paare
show_pairs() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}📋 Verfügbare Swap-Paare${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"

    response=$(curl -s "${BACKEND_API}/v2/swap/reverse")
    echo "$response" | jq .
}

# Hauptlogik
main() {
    local amount=10000
    local to="RBTC"
    local from="BTC"

    # Parse Argumente
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -p|--pairs)
                show_pairs
                exit 0
                ;;
            -s|--status)
                if [ -z "$2" ]; then
                    echo -e "${RED}❌ Fehler: --status benötigt SWAP_ID${NC}"
                    exit 1
                fi
                show_swap_status "$2"
                exit 0
                ;;
            -a|--amount)
                amount="$2"
                shift
                ;;
            -t|--to)
                to="$2"
                shift
                ;;
            -c|--citrea)
                to="cBTC"
                ;;
            -r|--rsk)
                to="RBTC"
                ;;
            *)
                echo -e "${RED}❌ Unbekannte Option: $1${NC}"
                show_help
                exit 1
                ;;
        esac
        shift
    done

    # Erstelle Swap
    create_reverse_swap "$from" "$to" "$amount"
}

# Prüfe ob jq installiert ist
if ! command -v jq &> /dev/null; then
    echo -e "${RED}❌ Fehler: 'jq' ist nicht installiert${NC}"
    echo "   Installiere es mit: brew install jq"
    exit 1
fi

# Führe Hauptfunktion aus
main "$@"

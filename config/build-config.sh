#!/bin/bash
# Build Boltz configuration from template and secrets file
# Script is located in the VM in the Boltz Backend volume

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SECRETS_FILE="$SCRIPT_DIR/boltz.config.secrets"
TEMPLATE_FILE="$SCRIPT_DIR/boltz.conf.template"
OUTPUT_FILE="$SCRIPT_DIR/boltz.conf"

echo "Building configuration..."
echo "  Secrets:  $SECRETS_FILE"
echo "  Template: $TEMPLATE_FILE"
echo "  Output:   $OUTPUT_FILE"
echo ""

if [[ ! -f "$SECRETS_FILE" ]]; then
    echo "Error: Secrets file not found: $SECRETS_FILE"
    exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
    echo "Error: Template file not found: $TEMPLATE_FILE"
    exit 1
fi

cp "$TEMPLATE_FILE" "$OUTPUT_FILE"

# Read each KEY:value line and replace [KEY] with value using awk
while IFS= read -r line; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue

    # Parse KEY:value format (value is everything after first colon)
    if [[ "$line" =~ ^([A-Z_]+):(.*)$ ]]; then
        KEY="${BASH_REMATCH[1]}"
        VALUE="${BASH_REMATCH[2]}"

        # awk with literal string replacement (no regex interpretation)
        awk -v key="[$KEY]" -v val="$VALUE" '{
            while (idx = index($0, key)) {
                $0 = substr($0, 1, idx-1) val substr($0, idx+length(key))
            }
            print
        }' "$OUTPUT_FILE" > "${OUTPUT_FILE}.tmp" && mv "${OUTPUT_FILE}.tmp" "$OUTPUT_FILE"
    fi
done < "$SECRETS_FILE"

echo "Configuration built successfully: $OUTPUT_FILE"

REMAINING=$(grep -o '\[[A-Z_]*\]' "$OUTPUT_FILE" 2>/dev/null | sort -u || true)
if [[ -n "$REMAINING" ]]; then
    echo "Warning: Unreplaced placeholders:"
    echo "$REMAINING"
fi

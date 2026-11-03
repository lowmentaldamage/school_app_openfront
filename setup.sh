#!/bin/bash
# Comprehensive setup script for Hetzner server with Docker, user setup, Node Exporter, and OpenTelemetry
# Exit on error
set -e

echo "====================================================="
echo "🚀 STARTING SERVER SETUP"
echo "====================================================="

# Load environment variables from .env.setup if present
ENV_FILE="$(dirname "$0")/.env.setup"
if [ -f "$ENV_FILE" ]; then
    echo "📂 Loading environment from $ENV_FILE"
    set -a
    # shellcheck source=/dev/null
    source "$ENV_FILE"
    set +a
else
    echo "ℹ️  No .env.setup file found"
    exit 1
fi

# Verify required environment variables
if [ -z "$OTEL_EXPORTER_OTLP_ENDPOINT" ] || [ -z "$OTEL_AUTH_HEADER" ]; then
    echo "❌ ERROR: Required environment variables are not set!"
    echo "Please set OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_AUTH_HEADER in .env.setup"
    exit 1
fi

# CF_ORIGIN_CERT and CF_ORIGIN_KEY: Cloudflare Origin Certificate and private key.
# Generate at: Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate
if [ -z "$CF_ORIGIN_CERT" ] || [ -z "$CF_ORIGIN_KEY" ]; then
    echo "❌ ERROR: CF_ORIGIN_CERT and CF_ORIGIN_KEY are not set!"
    echo "Generate an origin certificate at: Cloudflare → SSL/TLS → Origin Server → Create Certificate"
    echo "Then add CF_ORIGIN_CERT and CF_ORIGIN_KEY to .env.setup"
    exit 1
fi

echo "🔄 Updating system..."
apt update && apt upgrade -y

# Install jq (used by update.sh for asset upload)
if command -v jq &> /dev/null; then
    echo "jq is already installed"
else
    echo "📦 Installing jq..."
    apt install -y jq
fi

# Check if Docker is already installed
if command -v docker &> /dev/null; then
    echo "Docker is already installed"
else
    echo "🐳 Installing Docker..."
    # Install Docker using official script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    echo "Docker installed successfully"
fi

echo "👤 Setting up laukolaroser user..."
# Create laukolaroser user if it doesn't exist
if id "laukolaroser" &> /dev/null; then
    echo "User laukolaroser already exists"
else
    useradd -m -s /bin/bash laukolaroser
    echo "User laukolaroser created"
fi

# Check if laukolaroser is already in docker group
if groups laukolaroser | grep -q '\bdocker\b'; then
    echo "User laukolaroser is already in the docker group"
else
    # Add laukolaroser to docker group
    usermod -aG docker laukolaroser
    echo "Added laukolaroser to docker group"
fi

# Create .ssh directory for laukolaroser if it doesn't exist
if [ ! -d "/home/laukolaroser/.ssh" ]; then
    mkdir -p /home/laukolaroser/.ssh
    chmod 700 /home/laukolaroser/.ssh
    echo "Created .ssh directory for laukolaroser"
fi

# Copy SSH keys from root if they exist and haven't been copied yet
if [ -f /root/.ssh/authorized_keys ] && [ ! -f /home/laukolaroser/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/laukolaroser/.ssh/
    chmod 600 /home/laukolaroser/.ssh/authorized_keys
    echo "SSH keys copied from root to laukolaroser"
fi

# Configure UDP buffer sizes for Cloudflare Tunnel
# https://github.com/quic-go/quic-go/wiki/UDP-Buffer-Sizes
echo "🔧 Configuring UDP buffer sizes..."
# Check if settings already exist in sysctl.conf
if grep -q "net.core.rmem_max" /etc/sysctl.conf && grep -q "net.core.wmem_max" /etc/sysctl.conf; then
    echo "UDP buffer size settings already configured"
else
    # Add UDP buffer size settings to sysctl.conf
    echo "# UDP buffer size settings for improved QUIC performance" >> /etc/sysctl.conf
    echo "net.core.rmem_max=7500000" >> /etc/sysctl.conf
    echo "net.core.wmem_max=7500000" >> /etc/sysctl.conf

    # Apply the settings immediately
    sysctl -p
    echo "UDP buffer sizes configured and applied"
fi

# Set proper ownership for laukolaroser's home directory
chown -R laukolaroser:laukolaroser /home/laukolaroser
echo "Set proper ownership for laukolaroser's home directory"

# Set up Traefik reverse proxy
echo "🔀 Setting up Traefik..."

# Create the shared Docker network used by Traefik and app containers
if docker network ls --format '{{.Name}}' | grep -q '^web$'; then
    echo "Docker network 'web' already exists"
else
    docker network create web
    echo "Created Docker network 'web'"
fi

TRAEFIK_CONFIG_DIR="/home/laukolaroser/traefik"
TRAEFIK_CERTS_DIR="$TRAEFIK_CONFIG_DIR/certs"
mkdir -p "$TRAEFIK_CERTS_DIR"

# Write Cloudflare origin certificate and key (passed as env vars)
echo "$CF_ORIGIN_CERT" > "$TRAEFIK_CERTS_DIR/origin.crt"
echo "$CF_ORIGIN_KEY" > "$TRAEFIK_CERTS_DIR/origin.key"
chmod 600 "$TRAEFIK_CERTS_DIR/origin.crt" "$TRAEFIK_CERTS_DIR/origin.key"

# No [api] block — dashboard is disabled for production.
# To access it for debugging, SSH tunnel: ssh -L 8080:localhost:8080 user@server
cat > "$TRAEFIK_CONFIG_DIR/traefik.toml" << 'EOF'
[log]
  level = "INFO"

[entryPoints]
  [entryPoints.websecure]
    address = ":443"

[providers]
  [providers.docker]
    endpoint = "unix:///var/run/docker.sock"
    exposedByDefault = false   # Only route containers with traefik.enable=true
    network = "web"
    watch = true
  [providers.file]
    filename = "/etc/traefik/tls.toml"
    watch = true
EOF

# Static TLS configuration referencing the Cloudflare origin cert
cat > "$TRAEFIK_CONFIG_DIR/tls.toml" << 'EOF'
[[tls.certificates]]
  certFile = "/certs/origin.crt"
  keyFile  = "/certs/origin.key"

[tls.options]
  [tls.options.default]
    minVersion = "VersionTLS12"
EOF

cat > "$TRAEFIK_CONFIG_DIR/compose.yaml" << 'EOF'
networks:
  web:
    # External so blue/green containers can join independently.
    external: true

services:
  traefik:
    image: traefik:v3.6
    container_name: traefik
    restart: unless-stopped
    ports:
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /home/laukolaroser/traefik/traefik.toml:/etc/traefik/traefik.toml:ro
      - /home/laukolaroser/traefik/tls.toml:/etc/traefik/tls.toml:ro
      - /home/laukolaroser/traefik/certs:/certs:ro
    networks:
      - web
EOF

# Give laukolaroser ownership of config files but keep certs owned by root.
# Traefik runs as root inside its container so it can read them, but the
# laukolaroser app user cannot access the TLS private key.
chown -R laukolaroser:laukolaroser "$TRAEFIK_CONFIG_DIR"
chown root:root "$TRAEFIK_CERTS_DIR" "$TRAEFIK_CERTS_DIR/origin.crt" "$TRAEFIK_CERTS_DIR/origin.key"

docker compose -f "$TRAEFIK_CONFIG_DIR/compose.yaml" pull
docker compose -f "$TRAEFIK_CONFIG_DIR/compose.yaml" up -d

if docker ps | grep -q traefik; then
    echo "✅ Traefik started successfully!"
else
    echo "❌ Failed to start Traefik. Check logs with: docker logs traefik"
    exit 1
fi

# Create directory for OpenTelemetry configuration
echo "📊 Setting up Node Exporter and OpenTelemetry Collector..."
OTEL_CONFIG_DIR="/home/laukolaroser/otel"

if [ ! -d "$OTEL_CONFIG_DIR" ]; then
    mkdir -p "$OTEL_CONFIG_DIR"
    echo "Created OpenTelemetry configuration directory"
fi

# Create OpenTelemetry Collector configuration
cat > "$OTEL_CONFIG_DIR/otel-collector-config.yaml" << EOF
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: 'node'
          scrape_interval: 10s
          static_configs:
            - targets: ['localhost:9100']  # Node Exporter endpoint
          relabel_configs:
            - source_labels: [__address__]
              regex: '.*'
              target_label: laukolaroser.host
              replacement: "\${HOSTNAME}"

processors:
  batch:
    # Batch metrics before sending
    timeout: 10s
    send_batch_size: 1000

exporters:
  otlphttp:
    endpoint: "${OTEL_EXPORTER_OTLP_ENDPOINT}"
    headers:
      Authorization: "Basic ${OTEL_AUTH_HEADER}"
    tls:
      insecure: true  # Set to false in production with proper certs

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch]
      exporters: [otlphttp]
EOF

# Set ownership of all files
chmod 600 "$OTEL_CONFIG_DIR/otel-collector-config.yaml"
chown -R laukolaroser:laukolaroser "$OTEL_CONFIG_DIR"

# Run Node Exporter
echo "🚀 Starting Node Exporter..."
docker pull prom/node-exporter:latest
docker rm -f node-exporter 2> /dev/null || true
docker run -d \
    --name=node-exporter \
    --restart=unless-stopped \
    --net="host" \
    --pid="host" \
    -v "/:/host:ro,rslave" \
    prom/node-exporter:latest \
    --path.rootfs=/host

# Run OpenTelemetry Collector
echo "🚀 Starting OpenTelemetry Collector..."
docker pull otel/opentelemetry-collector-contrib:latest
docker rm -f otel-collector 2> /dev/null || true
# Run OpenTelemetry Collector with appropriate permissions
echo "🚀 Starting OpenTelemetry Collector..."
docker pull otel/opentelemetry-collector-contrib:latest
docker rm -f otel-collector 2> /dev/null || true

docker run -d \
    --name=otel-collector \
    --restart=unless-stopped \
    --network=host \
    --user=0 \
    -v "$OTEL_CONFIG_DIR/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro" \
    otel/opentelemetry-collector-contrib:latest

# Check if containers are running
if docker ps | grep -q node-exporter && docker ps | grep -q otel-collector; then
    echo "✅ Node Exporter and OpenTelemetry Collector started successfully!"
else
    echo "❌ Failed to start containers. Check logs with: docker logs node-exporter or docker logs otel-collector"
    exit 1
fi

echo "====================================================="
echo "🎉 SETUP COMPLETE!"
echo "====================================================="
echo "The laukolaroser user has been set up and has Docker permissions."
echo "UDP buffer sizes have been configured for optimal QUIC/WebSocket performance."
echo "Traefik reverse proxy is running (HTTP :80, HTTPS :443 with Cloudflare origin cert)."
echo "Node Exporter is collecting system metrics."
echo "OpenTelemetry Collector is forwarding metrics to your endpoint."
echo ""
echo "📝 Configuration:"
echo "   - Config Directory: $OTEL_CONFIG_DIR"
echo "   - OpenTelemetry Endpoint: $OTEL_EXPORTER_OTLP_ENDPOINT"
echo "====================================================="

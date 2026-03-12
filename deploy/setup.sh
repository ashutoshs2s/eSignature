#!/bin/bash
# BuyerForesight eSign — EC2 deployment script for sign.datastacksignal.com
# Run as root or with sudo on a fresh Ubuntu 22.04+ EC2 instance

set -e

DOMAIN="sign.datastacksignal.com"
APP_DIR="/opt/buyerforesight-esign"
NODE_VERSION="20"

echo "=== Installing system dependencies ==="
apt-get update
apt-get install -y curl nginx certbot python3-certbot-nginx build-essential

echo "=== Installing Node.js ${NODE_VERSION} ==="
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs

echo "=== Installing PM2 ==="
npm install -g pm2

echo "=== Setting up application ==="
mkdir -p ${APP_DIR}
cp -r . ${APP_DIR}/
cd ${APP_DIR}
npm install --production

echo "=== Configuring environment ==="
if [ ! -f ${APP_DIR}/.env ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  cat > ${APP_DIR}/.env << EOF
PORT=3000
SESSION_SECRET=${SESSION_SECRET}
NODE_ENV=production
EOF
  echo "Generated .env with random session secret"
fi

echo "=== Setting up Nginx ==="
cp deploy/nginx.conf /etc/nginx/sites-available/${DOMAIN}
ln -sf /etc/nginx/sites-available/${DOMAIN} /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx

echo "=== Getting SSL certificate ==="
echo "Make sure DNS for ${DOMAIN} points to this server's IP first!"
echo ""
read -p "Is DNS configured? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email admin@datastacksignal.com
else
  echo "Skipping SSL. Run this later:"
  echo "  certbot --nginx -d ${DOMAIN} --agree-tos --email admin@datastacksignal.com"
fi

echo "=== Starting application with PM2 ==="
cd ${APP_DIR}
pm2 start src/server.js --name buyerforesight-esign --env production
pm2 startup systemd -u root --hp /root
pm2 save

echo ""
echo "=== Deployment complete! ==="
echo "App running at: https://${DOMAIN}"
echo ""
echo "First visit: register to create your admin account."
echo "Then use Admin > Invite User to add team members."
echo ""
echo "Useful commands:"
echo "  pm2 status                  — check app status"
echo "  pm2 logs buyerforesight-esign — view logs"
echo "  pm2 restart buyerforesight-esign — restart app"

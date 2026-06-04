# Force internal NGINX to switch to other ports (so we can use them instead)
# NOTE: Recommend setting this up to run on every boot
sed -i -e 's/80/81/' -e 's/443/444/' /usr/syno/share/nginx/server.mustache /usr/syno/share/nginx/DSM.mustache /usr/syno/share/nginx/WWWService.mustache
synosystemctl restart nginx

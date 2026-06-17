# Nginx config (delivered via git)

Drop-in server blocks for the three domains. The **only one that must replace
your current config** is `api.innosynch.com.conf` — the others are reference
proxies you can adopt if you like.

## Why api needed fixing

The old nginx was injecting its own `Access-Control-*` headers and dropping
`Access-Control-Allow-Origin`, so every cross-origin call from dpp/admin to the
API failed CORS (login, google-login, …). These configs let the **Node app**
own CORS (it already sets `origin: *`) and tell nginx to stay out of it.

## One-time setup on the server

```bash
cd <backend-dir> && git pull

# point the api site at the repo file (adjust path to your backend checkout)
sudo ln -sf "$(pwd)/deploy/nginx/api.innosynch.com.conf" \
            /etc/nginx/sites-enabled/api.innosynch.com.conf

# remove the OLD api site file if it has a different name, e.g.:
# sudo rm /etc/nginx/sites-enabled/api.innosynch.com   (the previous one)

sudo nginx -t && sudo systemctl reload nginx
```

Because it's a symlink to the repo file, future updates are just
`git pull && sudo systemctl reload nginx` — no console editing.

## Verify CORS is fixed

```bash
curl -s -i -X OPTIONS https://api.innosynch.com/user/login \
  -H "Origin: https://dpp.innosynch.com" \
  -H "Access-Control-Request-Method: POST" | grep -i access-control
```
You must now see a line: `Access-Control-Allow-Origin: *`.

## Notes

- Cert paths assume Let's Encrypt (`/etc/letsencrypt/live/<domain>/`). Adjust if
  your certs live elsewhere.
- `dpp` proxies to `:3001` (app `npm run web`), `admin` to `:3000`. Change the
  ports if yours differ.

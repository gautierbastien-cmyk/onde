#!/usr/bin/env python3
"""Relais personnel d'Onde — à faire tourner sur le Raspberry Pi (ou n'importe quel serveur).

Sans dépendance (bibliothèque standard Python 3.8+).

  GET  /health                 → {"ok": true}
  GET  /meta?url=<flux>        → {"streamTitle": …} lus dans les métadonnées ICY
  GET  /stream?url=<flux>      → le flux audio, avec les en-têtes CORS (lecture HTTP et capture Shazam)
  POST /shazam                 → transmet une empreinte {uri, samplems, timezone} à Shazam
  GET  /cover?artist=…&title=… → pochettes Spotify (identifiants dans spotify.env, à côté du script)

Usage : python3 onde-relais.py [port] [origine autorisée]
Exemple : python3 onde-relais.py 8495 https://gautierbastien-cmyk.github.io
"""
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import base64
import os
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8495
ORIGIN = sys.argv[2] if len(sys.argv) > 2 else "*"
UA = "Onde/1.0"
SHAZAM_UA = "Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)"


def target(query):
    raw = urllib.parse.parse_qs(query).get("url", [""])[0]
    u = urllib.parse.urlparse(raw)
    return raw if u.scheme in ("http", "https") and u.netloc else None


def read_icy_title(url):
    req = urllib.request.Request(url, headers={"Icy-MetaData": "1", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as res:
        metaint = int(res.headers.get("icy-metaint") or 0)
        if not metaint:
            return {"error": "no-metadata"}
        for _ in range(30):  # titre vide à la connexion (Shoutcast) : on lit les blocs suivants
            res.read(metaint)
            length = res.read(1)[0] * 16
            if not length:
                continue
            text = res.read(length).decode("utf-8", "replace")
            m = re.search(r"StreamTitle='(.*?)';", text, re.S)
            if m and m.group(1).strip():
                su = re.search(r"StreamUrl='(.*?)';", text, re.S)
                return {"streamTitle": m.group(1).strip(), "streamUrl": su.group(1) if su else None}
    return {"streamTitle": ""}


def shazam(payload):
    now = int(time.time() * 1000)
    body = json.dumps({
        "geolocation": {"altitude": 300, "latitude": 45, "longitude": 2},
        "signature": {"samplems": int(payload["samplems"]), "timestamp": now, "uri": payload["uri"]},
        "timestamp": now,
        "timezone": payload.get("timezone") or "Europe/Paris",
    }).encode()
    url = (f"https://amp.shazam.com/discovery/v5/fr/FR/android/-/tag/{str(uuid.uuid4()).upper()}/{uuid.uuid4()}"
           "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3")
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "User-Agent": SHAZAM_UA, "Content-Language": "fr_FR"})
    with urllib.request.urlopen(req, timeout=15) as res:
        return res.read()


# ——— Spotify (client credentials : aucune connexion utilisateur) ———

SPOTIFY_ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spotify.env")
_token = {"value": None, "expires": 0}
_token_lock = threading.Lock()


def spotify_credentials():
    if not os.path.exists(SPOTIFY_ENV):
        return None
    env = {}
    for line in open(SPOTIFY_ENV):
        k, _, v = line.strip().partition("=")
        if k and v:
            env[k.strip()] = v.strip().strip('"')
    cid, secret = env.get("SPOTIFY_CLIENT_ID"), env.get("SPOTIFY_CLIENT_SECRET")
    return (cid, secret) if cid and secret else None


def spotify_token():
    with _token_lock:
        if _token["value"] and time.time() < _token["expires"] - 60:
            return _token["value"]
        creds = spotify_credentials()
        if not creds:
            return None
        auth = base64.b64encode(f"{creds[0]}:{creds[1]}".encode()).decode()
        req = urllib.request.Request("https://accounts.spotify.com/api/token", data=b"grant_type=client_credentials",
                                     method="POST", headers={"Authorization": "Basic " + auth,
                                                             "Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=10) as res:
            data = json.loads(res.read())
        _token.update(value=data["access_token"], expires=time.time() + int(data.get("expires_in", 3600)))
        return _token["value"]


def spotify_search(artist, title):
    token = spotify_token()
    if not token:
        return None
    q = urllib.parse.quote(f'track:"{title}" artist:"{artist}"')
    req = urllib.request.Request(f"https://api.spotify.com/v1/search?q={q}&type=track&limit=8",
                                 headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=10) as res:
        items = json.loads(res.read()).get("tracks", {}).get("items", [])
    out = []
    for t in items:
        images = (t.get("album") or {}).get("images") or []
        if not images:
            continue
        out.append({
            "title": t.get("name", ""),
            "artists": [a.get("name", "") for a in t.get("artists", [])],
            "album": (t.get("album") or {}).get("name"),
            "image": images[0]["url"],  # la plus grande (640 px)
            "url": (t.get("external_urls") or {}).get("spotify"),
            "duration_ms": t.get("duration_ms"),
        })
    return out


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", ORIGIN)
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")

    def reply(self, status, data, ctype="application/json"):
        body = data if isinstance(data, bytes) else json.dumps(data).encode()
        self.send_response(status)
        self.cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path, _, query = self.path.partition("?")
        path = "/" + path.rstrip("/").split("/")[-1]  # tolère un préfixe (route Caddy)
        if path == "/health":
            return self.reply(200, {"ok": True, "spotify": spotify_credentials() is not None})
        if path == "/cover":
            qs = urllib.parse.parse_qs(query)
            artist, title = qs.get("artist", [""])[0], qs.get("title", [""])[0]
            if not artist or not title:
                return self.reply(400, {"error": "artist et title requis"})
            try:
                results = spotify_search(artist, title)
            except urllib.error.HTTPError as e:
                if e.code == 401:
                    _token["value"] = None
                return self.reply(502, {"error": f"Spotify HTTP {e.code}"})
            except Exception as e:  # noqa: BLE001
                return self.reply(502, {"error": str(e)})
            if results is None:
                return self.reply(501, {"error": "spotify-non-configure"})
            return self.reply(200, {"provider": "spotify", "results": results})
        url = target(query)
        if not url:
            return self.reply(400, {"error": "url manquante ou invalide"})
        if path == "/meta":
            try:
                return self.reply(200, read_icy_title(url))
            except Exception as e:  # noqa: BLE001
                return self.reply(502, {"error": str(e)})
        if path == "/stream":
            try:
                upstream = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=10)
            except Exception as e:  # noqa: BLE001
                return self.reply(502, {"error": str(e)})
            self.send_response(200)
            self.cors()
            self.send_header("Content-Type", upstream.headers.get("Content-Type", "audio/mpeg"))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            try:
                while True:
                    chunk = upstream.read(8192)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                upstream.close()
                self.close_connection = True
            return
        return self.reply(404, {"error": "route inconnue"})

    def do_POST(self):
        path = "/" + self.path.split("?")[0].rstrip("/").split("/")[-1]
        if path != "/shazam":
            return self.reply(404, {"error": "route inconnue"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length > 512 * 1024:
                return self.reply(413, {"error": "trop volumineux"})
            payload = json.loads(self.rfile.read(length))
            if not str(payload.get("uri", "")).startswith("data:audio/vnd.shazam.sig;base64,"):
                return self.reply(400, {"error": "empreinte invalide"})
            return self.reply(200, shazam(payload))
        except urllib.error.HTTPError as e:
            return self.reply(502, {"error": f"Shazam HTTP {e.code}"})
        except Exception as e:  # noqa: BLE001
            return self.reply(502, {"error": str(e)})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"Relais Onde sur le port {PORT} (origine autorisée : {ORIGIN})")
    ThreadingHTTPServer(("0.0.0.0" if len(sys.argv) > 3 else "127.0.0.1", PORT), Handler).serve_forever()

import http.server
import socketserver
import urllib.request
import urllib.parse
import urllib.error
import sys

PORT = 8000

class ProxyHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/proxy?url='):
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            target_url = params.get('url', [''])[0]
            
            if target_url:
                try:
                    req = urllib.request.Request(
                        target_url, 
                        headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
                    )
                    with urllib.request.urlopen(req, timeout=15) as response:
                        data = response.read()
                    
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(data)
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(f"Proxy error: {str(e)}".encode('utf-8'))
            else:
                self.send_response(400)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self.wfile.write(b"Missing url parameter")
            return
            
        if self.path.startswith('/api/search?q='):
            import re
            qs = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(qs)
            query = params.get('q', [''])[0]
            
            if query:
                try:
                    search_url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(query)
                    req = urllib.request.Request(
                        search_url, 
                        headers={'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'}
                    )
                    with urllib.request.urlopen(req, timeout=10) as response:
                        html = response.read().decode('utf-8', errors='ignore')
                    
                    # Extract the first videoId
                    match = re.search(r'"videoId":"([a-zA-Z0-9_-]{11})"', html)
                    if match:
                        video_id = match.group(1)
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.end_headers()
                        import json
                        self.wfile.write(json.dumps({"videoId": video_id}).encode('utf-8'))
                    else:
                        self.send_response(404)
                        self.end_headers()
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
            else:
                self.send_response(400)
                self.end_headers()
            return
            
        # Serve normal static files
        return super().do_GET()

class DualStackServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True

if __name__ == '__main__':
    try:
        with DualStackServer(("", PORT), ProxyHTTPRequestHandler) as httpd:
            print(f"Server running at http://localhost:{PORT}")
            print("Press Ctrl+C to stop.")
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        sys.exit(0)

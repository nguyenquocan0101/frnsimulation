"""CLI/lifecycle entry point for the separate control service."""

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8766
DEFAULT_SCHEME = "wss"
PLAINTEXT_FALLBACK = False


def build_service(adapter, *, origins, calibration=None, audit=None):
    from bridge.control.service import ControlService
    return ControlService(adapter, origins=origins, calibration=calibration, audit=audit)


def run_wss(service, *, cert_file, key_file, host=DEFAULT_HOST, port=DEFAULT_PORT):
    """Start the service with a real TLS context; caller owns shutdown."""
    import asyncio
    from bridge.spikes.wss_probe_server import create_server_ssl_context
    from bridge.control.service import serve_websocket
    context = create_server_ssl_context(cert_file, key_file)
    async def serve_forever():
        server = await serve_websocket(service, context, host=host, port=port)
        try:
            await asyncio.Future()
        finally:
            server.close()
            await server.wait_closed()
    return asyncio.run(serve_forever())


def main():
    import argparse
    parser = argparse.ArgumentParser(description="FAIRINO loopback WSS control bridge")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cert")
    parser.add_argument("--key")
    args = parser.parse_args()
    if args.dry_run:
        print("Control bridge dry-run: disarmed; no robot connection opened")
        return 0
    if not args.cert or not args.key:
        raise SystemExit("Production requires --cert and --key from the trusted Windows launcher")
    raise SystemExit("Production adapter must be injected by the signed Windows launcher")


if __name__ == "__main__":
    main()

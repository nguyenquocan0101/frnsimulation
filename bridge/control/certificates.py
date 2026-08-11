"""Side-effect-free certificate rules for the local WSS installer.

This module never trusts a certificate, opens a Windows certificate store, or
contacts a robot.  The PowerShell installer owns those operator-confirmed
actions and consumes only the validated PEM/manifest data defined here.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import ntpath
import os
import re
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path, PureWindowsPath

from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


_THUMBPRINT = re.compile(r"^[0-9A-F]{40}$")
_INSTALL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$")
_SID = re.compile(r"^S-1-\d+(?:-\d+)+$")
_EXPECTED_DNS = frozenset({"localhost"})
_EXPECTED_IP = frozenset({"127.0.0.1"})
_EXPECTED_EKU = frozenset({ExtendedKeyUsageOID.SERVER_AUTH.dotted_string})


class CertificateLifecycleError(ValueError):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        super().__init__(message or code)


@dataclass(frozen=True)
class CertificateMetadata:
    thumbprint: str
    rsa_bits: int
    signature_hash: str
    dns_sans: frozenset[str]
    ip_sans: frozenset[str]
    eku_oids: frozenset[str]
    is_ca: bool
    not_before: datetime
    not_after: datetime
    public_key_matches: bool


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _require_string(value: object, code: str) -> str:
    if not isinstance(value, str) or not value:
        raise CertificateLifecycleError(code)
    return value


def validate_pem_pair(cert_pem: bytes, key_pem: bytes, *, now: datetime | None = None) -> CertificateMetadata:
    """Validate a strict 30-day localhost server certificate/key PEM pair."""
    try:
        cert = x509.load_pem_x509_certificate(cert_pem)
        key = serialization.load_pem_private_key(key_pem, password=None)
    except (TypeError, ValueError) as exc:
        raise CertificateLifecycleError("invalid_pem") from exc

    public = cert.public_key()
    if not isinstance(public, rsa.RSAPublicKey) or not isinstance(key, rsa.RSAPrivateKey):
        raise CertificateLifecycleError("rsa_key_required")
    if public.key_size < 2048 or key.key_size < 2048:
        raise CertificateLifecycleError("rsa_key_too_small")
    if cert.issuer != cert.subject:
        raise CertificateLifecycleError("self_signed_required")
    try:
        public.verify(cert.signature, cert.tbs_certificate_bytes, padding.PKCS1v15(), cert.signature_hash_algorithm)
    except (InvalidSignature, ValueError, TypeError) as exc:
        raise CertificateLifecycleError("self_signed_required") from exc
    signature = cert.signature_hash_algorithm
    if signature is None or signature.name.lower() != "sha256":
        raise CertificateLifecycleError("sha256_signature_required")
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        dns_sans = frozenset(san.get_values_for_type(x509.DNSName))
        ip_sans = frozenset(str(value) for value in san.get_values_for_type(x509.IPAddress))
    except x509.ExtensionNotFound as exc:
        raise CertificateLifecycleError("invalid_san") from exc
    if dns_sans != _EXPECTED_DNS or ip_sans != _EXPECTED_IP:
        raise CertificateLifecycleError("invalid_san")
    try:
        eku = cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
        eku_oids = frozenset(oid.dotted_string for oid in eku)
    except x509.ExtensionNotFound as exc:
        raise CertificateLifecycleError("server_auth_required") from exc
    if eku_oids != _EXPECTED_EKU:
        raise CertificateLifecycleError("server_auth_required")
    try:
        is_ca = cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    except x509.ExtensionNotFound as exc:
        raise CertificateLifecycleError("leaf_certificate_required") from exc
    if is_ca:
        raise CertificateLifecycleError("leaf_certificate_required")
    not_before = _utc(cert.not_valid_before_utc)
    not_after = _utc(cert.not_valid_after_utc)
    if not_after - not_before > timedelta(days=30):
        raise CertificateLifecycleError("validity_too_long")
    now = _utc(now or datetime.now(timezone.utc))
    if now < not_before or now > not_after:
        raise CertificateLifecycleError("certificate_not_current")
    cert_public = public.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    key_public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    if cert_public != key_public:
        raise CertificateLifecycleError("key_mismatch")
    return CertificateMetadata(
        thumbprint=cert.fingerprint(hashes.SHA1()).hex().upper(),
        rsa_bits=public.key_size,
        signature_hash=signature.name.lower(),
        dns_sans=dns_sans,
        ip_sans=ip_sans,
        eku_oids=eku_oids,
        is_ca=is_ca,
        not_before=not_before,
        not_after=not_after,
        public_key_matches=True,
    )


def validate_pem_der(cert_pem: bytes, key_pem: bytes, cert_der: bytes, *, now: datetime | None = None) -> CertificateMetadata:
    """Validate the PEM pair and prove its public DER is the same certificate."""
    metadata = validate_pem_pair(cert_pem, key_pem, now=now)
    try:
        pem_cert = x509.load_pem_x509_certificate(cert_pem)
        der_cert = x509.load_der_x509_certificate(cert_der)
    except (TypeError, ValueError) as exc:
        raise CertificateLifecycleError("invalid_der") from exc
    if pem_cert.public_bytes(serialization.Encoding.DER) != der_cert.public_bytes(serialization.Encoding.DER):
        raise CertificateLifecycleError("der_mismatch")
    return metadata


def generate_pem_pair(*, valid_days: int = 30) -> tuple[bytes, bytes, bytes, CertificateMetadata]:
    """Generate a machine-local PEM pair plus public DER for Current User trust."""
    if not isinstance(valid_days, int) or not 1 <= valid_days <= 30:
        raise CertificateLifecycleError("invalid_validity")
    now = datetime.now(timezone.utc)
    not_before = now.replace(microsecond=0)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(not_before)
        .not_valid_after(not_before + timedelta(days=valid_days))
        .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost"), x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]), critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    return cert_pem, key_pem, cert_der, validate_pem_pair(cert_pem, key_pem, now=now)


def build_manifest(
    *,
    install_id: str,
    owner_sid: str,
    cert_path: str,
    key_path: str,
    thumbprint: str,
    shortcuts: list[str],
    der_path: str | None = None,
) -> dict:
    if not _INSTALL_ID.fullmatch(_require_string(install_id, "invalid_install_id")):
        raise CertificateLifecycleError("invalid_install_id")
    if not _SID.fullmatch(_require_string(owner_sid, "invalid_owner_sid")):
        raise CertificateLifecycleError("invalid_owner_sid")
    thumbprint = _require_string(thumbprint, "invalid_thumbprint").upper()
    if not _THUMBPRINT.fullmatch(thumbprint):
        raise CertificateLifecycleError("invalid_thumbprint")
    if not isinstance(shortcuts, list) or not all(isinstance(item, str) and item for item in shortcuts):
        raise CertificateLifecycleError("invalid_shortcuts")
    cert_parent = _canonical_windows_path(cert_path).parent
    key_parent = _canonical_windows_path(key_path).parent
    if cert_parent != key_parent:
        raise CertificateLifecycleError("certificate_paths_mismatch")
    cert_path = _require_string(cert_path, "invalid_cert_path")
    key_path = _require_string(key_path, "invalid_key_path")
    der_path = der_path or _derive_der_path(cert_path)
    if _canonical_windows_path(der_path).parent != cert_parent:
        raise CertificateLifecycleError("certificate_paths_mismatch")
    return {
        "schema_version": 1,
        "install_id": install_id,
        "owner_sid": owner_sid,
        "install_root": str(cert_parent.parent),
        "certificate": {
            "thumbprint": thumbprint,
            "cert_path": cert_path,
            "key_path": key_path,
            "der_path": _require_string(der_path, "invalid_der_path"),
        },
        "shortcuts": list(shortcuts),
    }


def plan_rotation(current: dict, staged: dict, *, verified: bool) -> dict:
    current_cert, staged_cert = validate_rotation_manifests(current, staged)
    rollback = [staged_cert["thumbprint"], staged_cert["cert_path"], staged_cert["key_path"], staged_cert["der_path"]]
    if verified:
        return {"activate": staged, "remove": [current_cert["thumbprint"]], "rollback_remove": rollback}
    return {"activate": current, "remove": [], "rollback_remove": rollback}


def validate_rotation_manifests(current: dict, staged: dict) -> tuple[dict, dict]:
    """Reject cross-install or overlapping certificate material before swap."""
    _assert_same_owner(current, staged)
    current_cert = _certificate_record(current)
    staged_cert = _certificate_record(staged)
    if current_cert["thumbprint"] == staged_cert["thumbprint"]:
        raise CertificateLifecycleError("rotation_not_distinct")
    current_paths = {_canonical_windows_path(current_cert[key]) for key in ("cert_path", "key_path", "der_path")}
    staged_paths = {_canonical_windows_path(staged_cert[key]) for key in ("cert_path", "key_path", "der_path")}
    if current_paths & staged_paths:
        raise CertificateLifecycleError("rotation_paths_overlap")
    return current_cert, staged_cert


def uninstall_targets(manifest: dict, *, install_id: str, owner_sid: str, install_root: str) -> dict:
    if not isinstance(manifest, dict) or manifest.get("schema_version") != 1:
        raise CertificateLifecycleError("invalid_manifest")
    if manifest.get("install_id") != install_id or manifest.get("owner_sid") != owner_sid:
        raise CertificateLifecycleError("foreign_manifest")
    cert = _certificate_record(manifest)
    root = _canonical_windows_path(install_root)
    if _canonical_windows_path(_require_string(manifest.get("install_root"), "invalid_manifest")) != root:
        raise CertificateLifecycleError("foreign_manifest")
    files = [cert["cert_path"], cert["key_path"], cert["der_path"]]
    for item in files:
        if not _is_below_windows_path(item, root):
            raise CertificateLifecycleError("target_outside_install_root")
    shortcuts = manifest.get("shortcuts")
    if not isinstance(shortcuts, list) or not all(isinstance(item, str) and item.lower().endswith(".lnk") for item in shortcuts):
        raise CertificateLifecycleError("invalid_shortcuts")
    allowed_shortcuts = _allowed_shortcuts(root)
    if {_canonical_windows_path(item) for item in shortcuts} != allowed_shortcuts:
        raise CertificateLifecycleError("shortcut_outside_allowed_roots")
    return {"thumbprints": [cert["thumbprint"]], "files": files, "shortcuts": list(shortcuts)}


def _certificate_record(manifest: dict) -> dict:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("certificate"), dict):
        raise CertificateLifecycleError("invalid_manifest")
    certificate = manifest["certificate"]
    thumbprint = _require_string(certificate.get("thumbprint"), "invalid_thumbprint").upper()
    if not _THUMBPRINT.fullmatch(thumbprint):
        raise CertificateLifecycleError("invalid_thumbprint")
    return {
        "thumbprint": thumbprint,
        "cert_path": _require_string(certificate.get("cert_path"), "invalid_cert_path"),
        "key_path": _require_string(certificate.get("key_path"), "invalid_key_path"),
        "der_path": _require_string(certificate.get("der_path") or _derive_der_path(_require_string(certificate.get("cert_path"), "invalid_cert_path")), "invalid_der_path"),
    }


def _assert_same_owner(current: dict, staged: dict) -> None:
    if not isinstance(current, dict) or not isinstance(staged, dict):
        raise CertificateLifecycleError("invalid_manifest")
    if current.get("schema_version") != 1 or staged.get("schema_version") != 1:
        raise CertificateLifecycleError("invalid_manifest")
    if current.get("install_id") != staged.get("install_id") or current.get("owner_sid") != staged.get("owner_sid"):
        raise CertificateLifecycleError("foreign_manifest")
    current_root = _canonical_windows_path(_require_string(current.get("install_root"), "invalid_manifest"))
    staged_root = _canonical_windows_path(_require_string(staged.get("install_root"), "invalid_manifest"))
    if current_root != staged_root:
        raise CertificateLifecycleError("foreign_manifest")
    _certificate_record(current)
    _certificate_record(staged)


def _canonical_windows_path(value: str) -> PureWindowsPath:
    return PureWindowsPath(ntpath.normpath(str(value)))


def _derive_der_path(cert_path: str) -> str:
    path = _canonical_windows_path(cert_path)
    if not path.name.lower().endswith("-cert.pem"):
        raise CertificateLifecycleError("invalid_cert_path")
    return str(path.with_name(path.name[:-len(".pem")] + ".cer"))


def _is_below_windows_path(value: str, root: PureWindowsPath) -> bool:
    try:
        _canonical_windows_path(value).relative_to(root)
        return True
    except ValueError:
        return False


def _allowed_shortcuts(root: PureWindowsPath) -> set[PureWindowsPath]:
    try:
        home = root.parent.parent.parent
    except IndexError as exc:
        raise CertificateLifecycleError("invalid_install_root") from exc
    return {
        home / "Desktop" / "Start TechCamp Bridge.lnk",
        home / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Start TechCamp Bridge.lnk",
    }


def _main() -> int:
    parser = argparse.ArgumentParser(description="Generate a localhost WSS PEM certificate pair")
    commands = parser.add_subparsers(dest="command", required=True)
    generate = commands.add_parser("generate")
    generate.add_argument("--cert", required=True)
    generate.add_argument("--key", required=True)
    generate.add_argument("--der", required=True)
    generate.add_argument("--valid-days", type=int, default=30)
    validate = commands.add_parser("validate")
    validate.add_argument("--cert", required=True)
    validate.add_argument("--key", required=True)
    validate.add_argument("--der")
    manifest = commands.add_parser("manifest")
    manifest.add_argument("--install-id", required=True)
    manifest.add_argument("--owner-sid", required=True)
    manifest.add_argument("--cert", required=True)
    manifest.add_argument("--key", required=True)
    manifest.add_argument("--thumbprint", required=True)
    manifest.add_argument("--shortcut", action="append", default=[])
    args = parser.parse_args()
    if args.command == "validate":
        cert_pem = Path(args.cert).read_bytes()
        key_pem = Path(args.key).read_bytes()
        metadata = validate_pem_der(cert_pem, key_pem, Path(args.der).read_bytes()) if args.der else validate_pem_pair(cert_pem, key_pem)
        print(json.dumps({"thumbprint": metadata.thumbprint, "not_after": metadata.not_after.isoformat()}))
        return 0
    if args.command == "manifest":
        metadata = validate_pem_pair(Path(args.cert).read_bytes(), Path(args.key).read_bytes())
        if metadata.thumbprint != args.thumbprint.upper():
            raise CertificateLifecycleError("invalid_thumbprint", "Certificate thumbprint does not match PEM pair")
        print(json.dumps(build_manifest(
            install_id=args.install_id,
            owner_sid=args.owner_sid,
            cert_path=args.cert,
            key_path=args.key,
            thumbprint=metadata.thumbprint,
            shortcuts=args.shortcut,
        )))
        return 0
    cert_pem, key_pem, cert_der, metadata = generate_pem_pair(valid_days=args.valid_days)
    targets = [(Path(args.cert), cert_pem), (Path(args.key), key_pem), (Path(args.der), cert_der)]
    if any(path.exists() for path, _ in targets):
        raise CertificateLifecycleError("refuse_overwrite")
    temporary = []
    written = []
    try:
        for path, content in targets:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
            temp.write_bytes(content)
            temporary.append(temp)
        for (path, _), temp in zip(targets, temporary):
            os.replace(temp, path)
            written.append(path)
    except Exception:
        for path in [*temporary, *written]:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    print(json.dumps({"thumbprint": metadata.thumbprint, "not_after": metadata.not_after.isoformat()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())

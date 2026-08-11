"""Phase 02 RED contracts for the localhost certificate lifecycle.

These tests are intentionally side-effect free.  Certificate material is
created in memory, and the PowerShell scripts are inspected as text.  Nothing
in this module writes ``bridge/certs`` or opens a Windows certificate store.

Expected pure-module API (``bridge.control.certificates``):

``validate_pem_pair(cert_pem, key_pem, now=...)``
    Return metadata for a compliant pair or raise ``CertificateLifecycleError``.

``build_manifest(...)``
    Return the JSON-serializable ownership record for one installation.

``plan_rotation(current, staged, verified=...)``
    Return a JSON-serializable plan with ``activate``, ``remove`` and
    ``rollback_remove`` target lists.  An unverified staged pair may never
    replace or remove the current pair.

``uninstall_targets(manifest, install_id=..., owner_sid=..., install_root=...)``
    Return only the manifest-owned files, shortcuts and public thumbprint;
    reject ownership or path-scope mismatches.
"""

from __future__ import annotations

import importlib
import ipaddress
import re
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path, PureWindowsPath

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "bridge" / "scripts"
NOW = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
INSTALL_ID = "localhost-wss-machine-a"
OWNER_SID = "S-1-5-21-111-222-333-1001"
INSTALL_ROOT = PureWindowsPath(r"C:\Users\operator\AppData\Local\TechCampBridge")


def certificate_module():
    return importlib.import_module("bridge.control.certificates")


def pem_pair(
    *,
    rsa_bits: int = 2048,
    signature_hash: hashes.HashAlgorithm | None = None,
    dns_sans: tuple[str, ...] = ("localhost",),
    ip_sans: tuple[str, ...] = ("127.0.0.1",),
    server_auth: bool = True,
    is_ca: bool = False,
    validity_days: int = 30,
    key=None,
    issuer_name: str = "localhost",
) -> tuple[bytes, bytes]:
    """Build a self-signed localhost pair entirely in memory."""
    key = key or rsa.generate_private_key(public_exponent=65537, key_size=rsa_bits)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
    san_names = [x509.DNSName(value) for value in dns_sans]
    san_names.extend(x509.IPAddress(ipaddress.ip_address(value)) for value in ip_sans)
    eku = [ExtendedKeyUsageOID.SERVER_AUTH] if server_auth else [ExtendedKeyUsageOID.CLIENT_AUTH]
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, issuer_name)]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOW - timedelta(minutes=5))
        .not_valid_after(NOW + timedelta(days=validity_days) - timedelta(minutes=5))
        .add_extension(x509.SubjectAlternativeName(san_names), critical=False)
        .add_extension(x509.ExtendedKeyUsage(eku), critical=False)
        .add_extension(x509.BasicConstraints(ca=is_ca, path_length=None), critical=True)
        .sign(key, signature_hash or hashes.SHA256())
    )
    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    key_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return cert_pem, key_pem


def manifest(*, install_id=INSTALL_ID, owner_sid=OWNER_SID, suffix="current") -> dict:
    root = INSTALL_ROOT
    return {
        "schema_version": 1,
        "install_id": install_id,
        "owner_sid": owner_sid,
        "install_root": str(root),
        "certificate": {
            "thumbprint": ("AA" if suffix == "current" else "BB") * 20,
            "cert_path": str(root / "certs" / f"localhost-{suffix}-cert.pem"),
            "key_path": str(root / "certs" / f"localhost-{suffix}-key.pem"),
        },
        "shortcuts": [
            str(PureWindowsPath(r"C:\Users\operator\Desktop") / "Start TechCamp Bridge.lnk"),
            str(PureWindowsPath(r"C:\Users\operator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs") / "Start TechCamp Bridge.lnk"),
        ],
    }


class CertificatePairContractTests(unittest.TestCase):
    def validate(self, cert_pem: bytes, key_pem: bytes):
        return certificate_module().validate_pem_pair(cert_pem, key_pem, now=NOW)

    def assert_rejected(self, cert_pem: bytes, key_pem: bytes, code: str) -> None:
        module = certificate_module()
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.validate_pem_pair(cert_pem, key_pem, now=NOW)
        self.assertEqual(context.exception.code, code)

    def test_accepts_exact_localhost_rsa_sha256_server_certificate(self) -> None:
        cert_pem, key_pem = pem_pair()
        metadata = self.validate(cert_pem, key_pem)
        self.assertGreaterEqual(metadata.rsa_bits, 2048)
        self.assertEqual(metadata.signature_hash, "sha256")
        self.assertEqual(metadata.dns_sans, frozenset({"localhost"}))
        self.assertEqual(metadata.ip_sans, frozenset({"127.0.0.1"}))
        self.assertEqual(metadata.eku_oids, frozenset({ExtendedKeyUsageOID.SERVER_AUTH.dotted_string}))
        self.assertFalse(metadata.is_ca)
        self.assertLessEqual(metadata.not_after - metadata.not_before, timedelta(days=30))
        self.assertTrue(metadata.public_key_matches)
        self.assertRegex(metadata.thumbprint, r"^[0-9A-F]{40}$")

    def test_rejects_weak_or_non_rsa_private_keys(self) -> None:
        weak_cert, weak_key = pem_pair(rsa_bits=1024)
        self.assert_rejected(weak_cert, weak_key, "rsa_key_too_small")

        ec_key = ec.generate_private_key(ec.SECP256R1())
        ec_cert, ec_pem = pem_pair(key=ec_key)
        self.assert_rejected(ec_cert, ec_pem, "rsa_key_required")

    def test_rejects_non_sha256_signature(self) -> None:
        cert_pem, key_pem = pem_pair(signature_hash=hashes.SHA384())
        self.assert_rejected(cert_pem, key_pem, "sha256_signature_required")

    def test_rejects_missing_or_extra_san_identity(self) -> None:
        cert_pem, key_pem = pem_pair(ip_sans=())
        self.assert_rejected(cert_pem, key_pem, "invalid_san")

        cert_pem, key_pem = pem_pair(dns_sans=("localhost", "machine.local"))
        self.assert_rejected(cert_pem, key_pem, "invalid_san")

    def test_rejects_missing_server_auth_or_ca_certificate(self) -> None:
        cert_pem, key_pem = pem_pair(server_auth=False)
        self.assert_rejected(cert_pem, key_pem, "server_auth_required")

        cert_pem, key_pem = pem_pair(is_ca=True)
        self.assert_rejected(cert_pem, key_pem, "leaf_certificate_required")

    def test_rejects_validity_over_thirty_days(self) -> None:
        cert_pem, key_pem = pem_pair(validity_days=31)
        self.assert_rejected(cert_pem, key_pem, "validity_too_long")

    def test_rejects_private_key_that_does_not_match_certificate(self) -> None:
        cert_pem, _ = pem_pair()
        _, other_key = pem_pair()
        self.assert_rejected(cert_pem, other_key, "key_mismatch")

    def test_rejects_certificate_that_is_not_self_signed(self) -> None:
        cert_pem, key_pem = pem_pair(issuer_name="foreign-local-ca")
        self.assert_rejected(cert_pem, key_pem, "self_signed_required")

    def test_generator_produces_a_pair_that_passes_its_own_strict_validator(self) -> None:
        module = certificate_module()
        cert_pem, key_pem, cert_der, metadata = module.generate_pem_pair(valid_days=30)
        validated = module.validate_pem_pair(cert_pem, key_pem)
        self.assertEqual(validated.thumbprint, metadata.thumbprint)
        self.assertGreater(len(cert_der), 0)

    def test_rejects_a_public_der_from_a_different_valid_certificate(self) -> None:
        module = certificate_module()
        cert_pem, key_pem, cert_der, _ = module.generate_pem_pair(valid_days=30)
        _, _, other_der, _ = module.generate_pem_pair(valid_days=30)
        self.assertRegex(module.validate_pem_der(cert_pem, key_pem, cert_der).thumbprint, r"^[0-9A-F]{40}$")
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.validate_pem_der(cert_pem, key_pem, other_der)
        self.assertEqual(context.exception.code, "der_mismatch")


class ManifestLifecycleContractTests(unittest.TestCase):
    def test_manifest_records_exact_machine_ownership_and_targets(self) -> None:
        module = certificate_module()
        record = module.build_manifest(
            install_id=INSTALL_ID,
            owner_sid=OWNER_SID,
            cert_path=str(INSTALL_ROOT / "certs" / "localhost-current-cert.pem"),
            key_path=str(INSTALL_ROOT / "certs" / "localhost-current-key.pem"),
            thumbprint="AA" * 20,
            shortcuts=manifest()["shortcuts"],
        )
        self.assertEqual(record["install_id"], INSTALL_ID)
        self.assertEqual(record["owner_sid"], OWNER_SID)
        self.assertEqual(record["certificate"]["thumbprint"], "AA" * 20)
        self.assertNotIn("private_key", record["certificate"])
        self.assertNotIn("token", repr(record).lower())

    def test_verified_rotation_activates_new_before_removing_old(self) -> None:
        module = certificate_module()
        current = manifest(suffix="current")
        staged = manifest(suffix="staged")
        plan = module.plan_rotation(current, staged, verified=True)
        self.assertEqual(plan["activate"], staged)
        self.assertEqual(plan["remove"], [current["certificate"]["thumbprint"]])
        self.assertEqual(
            set(plan["rollback_remove"]),
            {
                staged["certificate"]["thumbprint"],
                staged["certificate"]["cert_path"],
                staged["certificate"]["key_path"],
                str(INSTALL_ROOT / "certs" / "localhost-staged-cert.cer"),
            },
        )

    def test_failed_rotation_retains_current_and_cleans_only_staged_targets(self) -> None:
        module = certificate_module()
        current = manifest(suffix="current")
        staged = manifest(suffix="staged")
        plan = module.plan_rotation(current, staged, verified=False)
        self.assertEqual(plan["activate"], current)
        self.assertEqual(plan["remove"], [])
        self.assertNotIn(current["certificate"]["thumbprint"], plan["rollback_remove"])
        self.assertNotIn(current["certificate"]["key_path"], plan["rollback_remove"])
        self.assertEqual(
            set(plan["rollback_remove"]),
            {
                staged["certificate"]["thumbprint"],
                staged["certificate"]["cert_path"],
                staged["certificate"]["key_path"],
                str(INSTALL_ROOT / "certs" / "localhost-staged-cert.cer"),
            },
        )

    def test_rotation_rejects_a_manifest_from_another_installation_or_owner(self) -> None:
        module = certificate_module()
        current = manifest(suffix="current")
        for staged in (manifest(suffix="staged", install_id="foreign-install"), manifest(suffix="staged", owner_sid="S-1-5-21-foreign")):
            with self.subTest(staged=staged["install_id"]):
                with self.assertRaises(module.CertificateLifecycleError) as context:
                    module.plan_rotation(current, staged, verified=True)
                self.assertEqual(context.exception.code, "foreign_manifest")

    def test_rotation_rejects_reused_thumbprint_or_overlapping_paths(self) -> None:
        module = certificate_module()
        current = manifest(suffix="current")
        same_thumbprint = manifest(suffix="staged")
        same_thumbprint["certificate"]["thumbprint"] = current["certificate"]["thumbprint"]
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.validate_rotation_manifests(current, same_thumbprint)
        self.assertEqual(context.exception.code, "rotation_not_distinct")

        same_paths = manifest(suffix="staged")
        same_paths["certificate"]["cert_path"] = current["certificate"]["cert_path"]
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.validate_rotation_manifests(current, same_paths)
        self.assertEqual(context.exception.code, "rotation_paths_overlap")

    def test_uninstall_returns_only_exact_manifest_owned_targets(self) -> None:
        module = certificate_module()
        record = manifest()
        targets = module.uninstall_targets(
            record,
            install_id=INSTALL_ID,
            owner_sid=OWNER_SID,
            install_root=str(INSTALL_ROOT),
        )
        self.assertEqual(targets["thumbprints"], [record["certificate"]["thumbprint"]])
        self.assertEqual(
            set(targets["files"]),
            {
                record["certificate"]["cert_path"],
                record["certificate"]["key_path"],
                str(INSTALL_ROOT / "certs" / "localhost-current-cert.cer"),
            },
        )
        self.assertEqual(targets["shortcuts"], record["shortcuts"])

    def test_uninstall_rejects_foreign_owner_or_out_of_root_file(self) -> None:
        module = certificate_module()
        for record in (
            manifest(owner_sid="S-1-5-21-foreign"),
            manifest(install_id="another-install"),
        ):
            with self.assertRaises(module.CertificateLifecycleError):
                module.uninstall_targets(
                    record,
                    install_id=INSTALL_ID,
                    owner_sid=OWNER_SID,
                    install_root=str(INSTALL_ROOT),
                )

        escaped = manifest()
        escaped["certificate"]["key_path"] = r"C:\Users\operator\Documents\unrelated-key.pem"
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.uninstall_targets(
                escaped,
                install_id=INSTALL_ID,
                owner_sid=OWNER_SID,
                install_root=str(INSTALL_ROOT),
            )
        self.assertIn(context.exception.code, {"target_outside_install_root", "invalid_cert_path"})

        mismatched_root = manifest()
        mismatched_root["install_root"] = r"C:\foreign"
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.uninstall_targets(mismatched_root, install_id=INSTALL_ID, owner_sid=OWNER_SID, install_root=str(INSTALL_ROOT))
        self.assertEqual(context.exception.code, "foreign_manifest")

        traversed = manifest()
        traversed["certificate"]["cert_path"] = str(INSTALL_ROOT / "certs" / ".." / ".." / "victim.pem")
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.uninstall_targets(traversed, install_id=INSTALL_ID, owner_sid=OWNER_SID, install_root=str(INSTALL_ROOT))
        self.assertIn(context.exception.code, {"target_outside_install_root", "invalid_cert_path"})

        malicious_shortcut = manifest()
        malicious_shortcut["shortcuts"] = [r"C:\Users\operator\Documents\victim.lnk"]
        with self.assertRaises(module.CertificateLifecycleError) as context:
            module.uninstall_targets(malicious_shortcut, install_id=INSTALL_ID, owner_sid=OWNER_SID, install_root=str(INSTALL_ROOT))
        self.assertEqual(context.exception.code, "shortcut_outside_allowed_roots")


class PowerShellLifecycleStaticContractTests(unittest.TestCase):
    def source(self, name: str) -> str:
        return (SCRIPTS / name).read_text(encoding="utf-8")

    def test_mutating_scripts_require_should_process_and_high_confirmation(self) -> None:
        for name in ("install-control-bridge.ps1", "uninstall-control-bridge.ps1"):
            with self.subTest(script=name):
                source = self.source(name)
                self.assertRegex(
                    source,
                    re.compile(r"\[CmdletBinding\([^\]]*SupportsShouldProcess\s*=\s*\$true[^\]]*ConfirmImpact\s*=\s*['\"]High['\"]", re.I | re.S),
                )
                self.assertRegex(source, re.compile(r"\$PSCmdlet\.ShouldProcess\s*\(", re.I))

    def test_trust_is_current_user_root_only_and_never_imports_a_private_key(self) -> None:
        sources = "\n".join(
            self.source(name)
            for name in (
                "new-localhost-dev-certificate.ps1",
                "new-control-bridge-manifest.ps1",
                "install-control-bridge.ps1",
                "uninstall-control-bridge.ps1",
            )
        )
        install = self.source("install-control-bridge.ps1")
        self.assertIn(r"Cert:\CurrentUser\Root", install)
        self.assertNotRegex(sources, re.compile(r"Cert:\\LocalMachine\\", re.I))
        self.assertNotRegex(sources, re.compile(r"Cert:\\CurrentUser\\My", re.I))
        self.assertNotRegex(sources, re.compile(r"Import-PfxCertificate|\.pfx\b|\.p12\b", re.I))
        self.assertRegex(install, re.compile(r"HasPrivateKey", re.I))
        self.assertRegex(install, re.compile(r"GetFullPath", re.I))
        self.assertRegex(install, re.compile(r"Thumbprint", re.I))

    def test_uninstall_is_manifest_and_thumbprint_scoped_without_wildcards(self) -> None:
        source = self.source("uninstall-control-bridge.ps1")
        self.assertRegex(source, re.compile(r"manifest", re.I))
        self.assertRegex(source, re.compile(r"thumbprint", re.I))
        self.assertNotRegex(source, re.compile(r"Cert:\\CurrentUser\\Root\\\*", re.I))
        self.assertNotRegex(source, re.compile(r"Remove-Item[^\r\n]*(?:-Recurse|-Force)[^\r\n]*\*", re.I))

    def test_scripts_derive_machine_boundary_and_validate_pem_before_trust(self) -> None:
        generate = self.source("new-localhost-dev-certificate.ps1")
        install = self.source("install-control-bridge.ps1")
        uninstall = self.source("uninstall-control-bridge.ps1")
        manifest = self.source("new-control-bridge-manifest.ps1")
        for source in (generate, manifest, install, uninstall):
            self.assertRegex(source, re.compile(r"\$PSScriptRoot", re.I))
            self.assertRegex(source, re.compile(r"bridgeRoot", re.I))
            self.assertRegex(source, re.compile(r"certs", re.I))
        self.assertNotRegex(generate, re.compile(r"\[string\]\$CertificatePath|\[string\]\$KeyPath|\[string\]\$DerPath", re.I))
        for source in (install, uninstall):
            self.assertNotRegex(source, re.compile(r"\[string\]\$OwnerSid|\[string\]\$InstallId|\[string\]\$InstallRoot", re.I))
            self.assertRegex(source, re.compile(r"WindowsIdentity\]::GetCurrent\(\)\.User", re.I))
        self.assertRegex(install, re.compile(r"bridge\.control\.certificates\s+validate", re.I))
        self.assertRegex(generate, re.compile(r"catch[\s\S]{0,800}Remove-Item\s+-LiteralPath", re.I))

    def test_rotation_requires_matching_verified_handshake_before_atomic_swap(self) -> None:
        rotate = self.source("rotate-control-bridge-certificate.ps1")
        self.assertRegex(rotate, re.compile(r"bridgeRoot", re.I))
        self.assertRegex(rotate, re.compile(r"bridge\.control\.certificates\s+validate", re.I))
        self.assertRegex(rotate, re.compile(r"handshake", re.I))
        self.assertRegex(rotate, re.compile(r"Thumbprint", re.I))
        self.assertRegex(rotate, re.compile(r"\[System\.IO\.File\]::Replace", re.I))
        self.assertRegex(rotate, re.compile(r"catch[\s\S]{0,1200}Remove-Item\s+-LiteralPath", re.I))
        self.assertNotRegex(rotate, re.compile(r"Cert:\\LocalMachine\\|Import-PfxCertificate", re.I))


if __name__ == "__main__":
    unittest.main()

# FAIRINO TCP/8083 status frame contract

The live-sync parser consumes the controller's binary status stream in
read-only mode. A frame is 433 bytes:

| Bytes | Field | Encoding |
| --- | --- | --- |
| 0–1 | Header magic `0x5A5A` | little-endian `uint16` |
| 2 | Frame count | `uint8` |
| 3–4 | Payload length (`426`) | little-endian `uint16` |
| 5–430 | Payload | 426 bytes |
| 431–432 | Checksum | little-endian `uint16`, `sum(header + payload) & 0xffff` |

Payload offsets are absolute within the payload (not the complete frame):

| Offset | Field | Encoding |
| --- | --- | --- |
| 0 | `program_state` | `uint8` |
| 1 | `robot_state` | `uint8` |
| 2 | status/mode byte | `uint8` |
| 3–50 | six joints | six little-endian `double`, degrees, J1…J6 |
| 51–98 | TCP pose | six little-endian `double`, X/Y/Z mm then RX/RY/RZ degrees |
| 99–425 | reserved/unused | preserved but not interpreted |

The parser must require at least 99 payload bytes, validate finite joint/TCP
values, and expose error/safety fields as unavailable (`null`) because this
stream does not contain a verified error/safety layout. Invalid frames are rejected
without terminating the stream reader; a following valid frame must remain
readable.

## Fixture provenance

`fixtures/status8083_valid.hex` is a deterministic synthetic fixture created
for TDD. It proves checksum and fragmentation handling only. A live capture
from the reachable FR5 was cross-checked against the read-only XML-RPC
`GetActualJointPosDegree` and `GetActualTCPPose` values; retain raw capture
metadata before claiming firmware-wide compatibility.

Record model, firmware, timestamp, network direction/handshake, and an
independently checked physical/SDK pose for future firmware variants. Do not
decode unverified safety bytes.

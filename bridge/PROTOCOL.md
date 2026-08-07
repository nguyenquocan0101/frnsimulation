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
| 2–5 | `main_code` | little-endian signed `int32` |
| 6–9 | `sub_code` | little-endian signed `int32` |
| 10 | `robot_mode` | `uint8` |
| 11–58 | six joints | six little-endian `double`, degrees, J1…J6 |
| 59–106 | TCP pose | six little-endian `double`, X/Y/Z mm then RX/RY/RZ degrees |
| 107–425 | reserved/unused | preserved but not interpreted |

The parser must require at least 107 payload bytes, validate finite joint/TCP
values, and expose safety fields as unavailable (`null`) because this captured
payload does not contain a verified safety layout. Invalid frames are rejected
without terminating the stream reader; a following valid frame must remain
readable.

## Fixture provenance

`fixtures/status8083_valid.hex` is a deterministic synthetic fixture created
for TDD because no raw FR5 controller capture was available at implementation
time. It uses frame count 17, program/robot/mode values `(7, 1, 3)`, error codes
`(-123, 456)`, and known joint/TCP vectors. It proves the byte offsets,
checksum, and fragmentation tests only. It is **not** evidence of controller
firmware compatibility.

Before enabling live sync or claiming parser correctness, replace/add a
byte-for-byte capture from the reachable FR5 controller and record model,
firmware, timestamp, network direction/handshake, and an independently checked
physical/SDK pose. Do not infer or shift offsets from a 433-byte synthetic
frame, and do not decode unverified safety bytes.

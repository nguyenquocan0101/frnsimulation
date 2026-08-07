import math
import struct
import unittest

from fr3_bridge import Status8083Parser, parse_status_frame


def make_frame(count=0x43, payload_len=426, joints=None, tcp=None):
    payload = bytearray(payload_len)
    struct.pack_into("<BBB", payload, 0, 1, 0, 1)
    joints = joints or [-2.455716, -129.484863, 104.017032, -173.919231, -141.451259, -33.744126]
    tcp = tcp or [246.614014, 751.953918, 762.721252, -77.274696, -17.006375, -66.891129]
    struct.pack_into("<6d", payload, 3, *joints)
    struct.pack_into("<6d", payload, 51, *tcp)
    header = struct.pack("<HBH", 0x5A5A, count, payload_len)
    checksum = struct.pack("<H", sum(header + payload) & 0xFFFF)
    return header + payload + checksum


class Status8083FrameTests(unittest.TestCase):
    def test_valid_frame_uses_controller_offsets_and_units(self):
        state = parse_status_frame(make_frame())
        self.assertEqual(state["type"], "robot_state")
        self.assertEqual(state["robot_model"], "FR5")
        self.assertEqual(state["joints"], [-2.455716, -129.484863, 104.017032, -173.919231, -141.451259, -33.744126])
        self.assertEqual(state["tcp"], [246.614014, 751.953918, 762.721252, -77.274696, -17.006375, -66.891129])
        self.assertEqual(state["program_state"], 1)
        self.assertIsNone(state["main_code"])
        self.assertIsNone(state["controller_safety"])

    def test_joint_one_is_not_dropped_or_shifted(self):
        state = parse_status_frame(make_frame())
        self.assertAlmostEqual(state["joints"][0], -2.455716, places=6)
        self.assertAlmostEqual(state["joints"][5], -33.744126, places=6)

    def test_bad_magic_length_checksum_and_truncated_are_rejected(self):
        frame = make_frame()
        bad_magic = b"\x00" + frame[1:]
        bad_length = bytearray(frame)
        struct.pack_into("<H", bad_length, 3, 98)
        bad_checksum = frame[:-2] + struct.pack("<H", 0)
        for invalid in (bad_magic, bytes(bad_length), bad_checksum, frame[:-1]):
            with self.assertRaises(ValueError):
                parse_status_frame(invalid)

    def test_nonfinite_values_are_rejected(self):
        frame = make_frame(joints=[math.nan, 0, 0, 0, 0, 0])
        with self.assertRaises(ValueError):
            parse_status_frame(frame)

    def test_parser_handles_fragmentation_and_concatenated_frames(self):
        parser = Status8083Parser()
        first, second = make_frame(0x43), make_frame(0x44)
        states = []
        joined = first + second
        for index in range(0, len(joined), 17):
            states.extend(parser.feed(joined[index:index + 17]))
        self.assertEqual(len(states), 2)
        self.assertEqual(states[0]["frame_count"], 0x43)
        self.assertEqual(states[1]["frame_count"], 0x44)

    def test_parser_resynchronizes_after_garbage_and_bad_checksum(self):
        parser = Status8083Parser()
        good = make_frame(0x50)
        bad = good[:-2] + struct.pack("<H", 0)
        states = parser.feed(b"garbage" + bad + good)
        self.assertEqual([state["frame_count"] for state in states], [0x50])


if __name__ == "__main__":
    unittest.main()

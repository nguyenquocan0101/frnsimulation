import math
import struct
import unittest

from fr3_bridge import Status8083Parser, parse_status_frame


def make_frame(count=0x43, payload_len=426, joints=None, tcp=None):
    payload = bytearray(payload_len)
    struct.pack_into("<BBiiB", payload, 0, 1, 0, 0, 0, 0)
    joints = joints or [-105.153, 102.395, -118.324, -70.149, -22.586, 232.121]
    tcp = tcp or [1089.126, 433.365, -142.932, 4.267, -0.986, 0.0]
    struct.pack_into("<6d", payload, 11, *joints)
    struct.pack_into("<6d", payload, 59, *tcp)
    header = struct.pack("<HBH", 0x5A5A, count, payload_len)
    checksum = struct.pack("<H", sum(header + payload) & 0xFFFF)
    return header + payload + checksum


class Status8083FrameTests(unittest.TestCase):
    def test_valid_frame_uses_confirmed_offsets_and_units(self):
        state = parse_status_frame(make_frame())
        self.assertEqual(state["type"], "robot_state")
        self.assertEqual(state["robot_model"], "FR5")
        self.assertEqual(state["joints"], [-105.153, 102.395, -118.324, -70.149, -22.586, 232.121])
        self.assertEqual(state["tcp"], [1089.126, 433.365, -142.932, 4.267, -0.986, 0.0])
        self.assertEqual(state["program_state"], 1)
        self.assertEqual(state["main_code"], 0)
        self.assertIsNone(state["controller_safety"])

    def test_old_shifted_bbb12d_layout_is_rejected(self):
        state = parse_status_frame(make_frame())
        self.assertNotAlmostEqual(state["joints"][0], -2.0)
        self.assertAlmostEqual(state["joints"][0], -105.153, places=6)

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

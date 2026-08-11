# FAIRINO control capability record

This is the release gate for real motion. The automated fake-adapter tests do
not prove controller behavior.

Before enabling the Real Robot mode, an operator must record the controller
model, firmware, SDK version, active tool/workpiece, AUTO-mode signal, and the
result of `spikes/fairino_stop_concurrency.py` using two independent clients.
The motion client must block in a bounded low-speed test while the independent
StopMotion client interrupts it. Record Stop pickup time and keep the physical
E-stop ready. A process/power failure can prevent software Stop, and mechanical
deceleration can exceed the software pickup time.

The production client factories must use bounded socket timeouts and a
one-shot MoveJ implementation; the vendored convenience wrapper's internal
socket retry loop is not an acceptable control boundary for ambiguous motion.

Current status: **UNVERIFIED — Real Robot mode remains disabled.**

"""Isolated Python runner for the FAIRINO browser simulator; never imports the real robot SDK."""

import ast
import builtins
import inspect
import json
import sys
import traceback
import types

VALID_POINTS = {"P1", "P2", "P3", "P4", "P5", "P6", "P7", "HOME", "HOMECHESS"}
BLOCK_POINTS = {"P1", "P2", "P3", "P4", "P5", "P6", "P7"}
CANONICAL_COMPETITION_FIXTURE = {
    "P1": None,
    "P2": "dog",
    "P3": "chicken",
    "P4": "chair",
    "P5": "house",
    "P6": "car",
    "P7": "marker",
}
CANONICAL_COMPETITION_OCCUPANCY = {
    point: block is not None
    for point, block in CANONICAL_COMPETITION_FIXTURE.items()
}
MAX_TRACE_ACTIONS = 500
MAX_STUDENT_LINE_EVENTS = 50_000
MAX_COLLECTION_ITEMS = 10_000


def _bounded_range(*args):
    result = range(*args)
    if len(result) > MAX_COLLECTION_ITEMS:
        raise TechCampError(f"range() is limited to {MAX_COLLECTION_ITEMS} items.")
    return result


def _bounded_collection(factory, iterable=()):
    values = []
    for index, value in enumerate(iterable):
        if index >= MAX_COLLECTION_ITEMS:
            raise TechCampError(f"Collections are limited to {MAX_COLLECTION_ITEMS} items.")
        values.append(value)
    return factory(values)


def _bounded_list(iterable=()):
    return _bounded_collection(list, iterable)


def _bounded_tuple(iterable=()):
    return _bounded_collection(tuple, iterable)


def _bounded_set(iterable=()):
    return _bounded_collection(set, iterable)


def normalize_point(position):
    point = str(position).upper()
    return "HOME" if point == "HOMECHESS" else point
FORBIDDEN_NAMES = {
    "breakpoint", "compile", "delattr", "dir", "eval", "exec", "getattr",
    "globals", "help", "input", "locals", "open", "setattr", "vars",
}


class TechCampError(Exception):
    pass


class MainEntrypointError(TechCampError):
    def __init__(self, message, line=None):
        super().__init__(message)
        self.lineno = line


class ProtocolError(TechCampError):
    def __init__(self, message, line=None):
        super().__init__(message)
        self.lineno = line


def _is_main_guard(node):
    """Return True for the exact workshop entrypoint guard."""
    if not isinstance(node, ast.If) or not isinstance(node.test, ast.Compare):
        return False
    test = node.test
    return (
        isinstance(test.left, ast.Name)
        and test.left.id == "__name__"
        and len(test.ops) == 1
        and isinstance(test.ops[0], ast.Eq)
        and len(test.comparators) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value == "__main__"
    )


def validate_main_entrypoint(tree):
    """Require an exact zero-argument main() invoked by the Python guard."""
    function_defs = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
    main_function = next((node for node in function_defs if node.name == "main"), None)
    if main_function is None:
        raise MainEntrypointError(
            "Define main() and call it from if __name__ == \"__main__\":.",
            getattr(tree.body[0], "lineno", 1) if tree.body else 1,
        )
    arguments = main_function.args
    if (
        arguments.args
        or arguments.posonlyargs
        or arguments.kwonlyargs
        or arguments.vararg
        or arguments.kwarg
    ):
        raise MainEntrypointError("main() must not require arguments.", main_function.lineno)

    guards = [node for node in tree.body if _is_main_guard(node)]
    if not guards:
        raise MainEntrypointError(
            "Call the main function from if __name__ == \"__main__\":.",
            main_function.lineno,
        )
    guard = guards[0]
    calls_function = next(
        (
            statement.value.func.id
            for statement in guard.body
            if isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Call)
            and isinstance(statement.value.func, ast.Name)
            and not statement.value.args
            and not statement.value.keywords
        ),
        None,
    )
    if calls_function != "main":
        raise MainEntrypointError(
            "The __main__ block must call main().", guard.lineno
        )


class SafetyVisitor(ast.NodeVisitor):
    def visit_Import(self, node):
        raise ProtocolError("Only use: from techcamp_api import TechCamp", node.lineno)

    def visit_ImportFrom(self, node):
        allowed = {"TechCamp", "TechCampError"}
        if node.module != "techcamp_api" or any(item.name not in allowed for item in node.names):
            raise ProtocolError("Only use: from techcamp_api import TechCamp", node.lineno)

    def visit_Name(self, node):
        if (node.id.startswith("__") and node.id != "__name__") or node.id in FORBIDDEN_NAMES:
            raise ProtocolError(f"'{node.id}' is not allowed in the simulator.", node.lineno)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr.startswith("_"):
            raise ProtocolError("Private attributes are not allowed in the simulator.", node.lineno)
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_NAMES:
            raise ProtocolError(f"'{node.func.id}()' is not allowed in the simulator.", node.lineno)
        self.generic_visit(node)


def _student_line():
    frame = inspect.currentframe()
    try:
        while frame:
            if frame.f_code.co_filename == "<student>":
                return frame.f_lineno
            frame = frame.f_back
    finally:
        del frame
    return None


class SimTechCamp:
    """Records student intent without hiding no-op or automatically repaired calls."""

    def __init__(self, raw_trace, positions):
        self._raw_trace = raw_trace
        self._positions = positions

    def _attempt(self, method, *args):
        if len(self._raw_trace) >= MAX_TRACE_ACTIONS:
            raise ProtocolError(
                f"Program exceeds the {MAX_TRACE_ACTIONS}-command limit.",
                _student_line(),
            )
        entry = {
            "method": method,
            "args": list(args),
            "line": _student_line(),
            "order": len(self._raw_trace) + 1,
        }
        self._raw_trace.append(entry)
        return entry

    def _record(self, action_type, **data):
        """Compatibility shim retained for code that inspects the simulator class."""
        frame = inspect.currentframe()
        while frame:
            if frame.f_code.co_filename == "<student>":
                data["line"] = frame.f_lineno
                break
            frame = frame.f_back
        return {"type": action_type, **data}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
        return False

    def move_to(self, position):
        self._attempt("move_to", str(position))
        point = normalize_point(position)
        if point not in VALID_POINTS:
            raise TechCampError(f"Invalid position '{position}'. Valid: P1…P7, HOME")
        return True

    def move_down(self):
        self._attempt("move_down")
        return True

    def move_up(self):
        self._attempt("move_up")
        return True

    def grip(self):
        self._attempt("grip")
        return True

    def release(self):
        self._attempt("release")
        return True

    def get_positions(self):
        self._attempt("get_positions")
        return dict(self._positions)

    def get_image(self):
        self._attempt("get_image")
        return {"type": "simulated_board", "positions": self.get_positions()}

    def close(self):
        return True


def _protocol_error(message, entry=None):
    raise ProtocolError(message, entry.get("line") if entry else None)


def validate_protocol_trace(raw_trace):
    """Validate calls while treating harmless grip/release mistakes as no-ops.

    Workshop code is allowed to experiment with an empty slot or an empty
    gripper. Those calls are retained in the trace with ``success=False`` so
    the browser can replay them without changing the scored fixture.
    """
    fixture = dict(CANONICAL_COMPETITION_FIXTURE)
    position = None
    low = False
    needs_down = False
    carried = None
    carried_source = None

    for entry in raw_trace:
        method = entry["method"]
        args = entry["args"]
        if method in {"get_positions", "get_image"}:
            continue

        if method == "move_to":
            point = normalize_point(args[0]) if args else ""
            if point not in VALID_POINTS:
                _protocol_error(f"Invalid position '{args[0] if args else ''}'. Valid: P1…P7, HOME", entry)
            if needs_down:
                _protocol_error("Each move_to(P) must be followed by move_down() before the next move_to().", entry)
            if low:
                _protocol_error("Call move_up() before moving horizontally to another point.", entry)
            if position == point:
                _protocol_error(f"move_to({point}) repeats the same current point.", entry)
            position = point
            low = False
            needs_down = point in BLOCK_POINTS
            continue

        if method == "move_down":
            if position not in BLOCK_POINTS:
                _protocol_error("move_down() requires move_to('P1'..'P7') first.", entry)
            if low:
                _protocol_error("move_down() was already called at this point.", entry)
            low = True
            needs_down = False
            continue

        if method == "move_up":
            if position not in BLOCK_POINTS or not low:
                _protocol_error("move_up() requires the gripper to be lowered first.", entry)
            low = False
            continue

        if method == "grip":
            if position not in BLOCK_POINTS or not low:
                entry["success"] = False
                continue
            if carried is not None:
                entry["success"] = False
                continue
            block = fixture[position]
            if block is None:
                entry["success"] = False
                continue
            if block == "marker":
                entry["success"] = False
                continue
            carried = block
            carried_source = position
            fixture[position] = None
            entry["success"] = True
            continue

        if method == "release":
            if position not in BLOCK_POINTS or not low:
                entry["success"] = False
                continue
            if carried is None:
                entry["success"] = False
                continue
            destination_block = fixture[position]
            if destination_block == "marker":
                entry["success"] = False
                continue
            if destination_block is not None:
                entry["success"] = False
                continue
            fixture[position] = carried
            carried = None
            carried_source = None
            entry["success"] = True
            continue

        _protocol_error(f"Unsupported TechCamp call: {method}.", entry)

    # A workshop run may end while carrying a block. The scored replay will
    # simply remain incomplete and receive no completion score.


def normalize_replay_actions(raw_trace):
    actions = []
    for entry in raw_trace:
        method = entry["method"]
        if method not in {"move_to", "move_down", "move_up", "grip", "release"}:
            continue
        action = {"type": method, "line": entry["line"]}
        action["success"] = entry.get("success", True)
        if method == "move_to":
            action["position"] = normalize_point(entry["args"][0])
        actions.append(action)
    return actions


def execute(payload):
    source = payload.get("source", "")
    if not isinstance(source, str):
        return {"ok": False, "error": {"message": "Code must be a string."}}
    try:
        tree = ast.parse(source, filename="<student>", mode="exec")
        validate_main_entrypoint(tree)
        SafetyVisitor().visit(tree)
        code = builtins.compile(tree, "<student>", "exec")
    except SyntaxError as error:
        return {"ok": False, "error": {"line": error.lineno, "column": error.offset, "message": error.msg}}
    except TechCampError as error:
        return {"ok": False, "error": {"line": getattr(error, "lineno", None), "message": str(error)}}

    raw_trace, output = [], []
    # Scored programs always observe the same post-opening fixture. Browser
    # state from a previous run is deliberately ignored.
    positions = dict(CANONICAL_COMPETITION_OCCUPANCY)

    def classroom_print(*values, sep=" ", end="\n", **_):
        output.append(sep.join(str(value) for value in values) + end)

    def only_techcamp_import(name, *_args, **_kwargs):
        if name != "techcamp_api":
            raise TechCampError("Only techcamp_api may be imported in the simulator.")
        return module

    module = types.ModuleType("techcamp_api")
    module.TechCamp = lambda *args, **kwargs: SimTechCamp(raw_trace, positions)
    module.TechCampError = TechCampError
    safe_builtins = {
        "__import__": only_techcamp_import, "abs": abs, "all": all, "any": any,
        "bool": bool, "dict": dict, "enumerate": enumerate, "float": float,
        "int": int, "len": len, "list": _bounded_list, "max": max, "min": min,
        "print": classroom_print, "range": _bounded_range, "round": round, "set": _bounded_set,
        "sorted": sorted, "str": str, "sum": sum, "tuple": _bounded_tuple, "zip": zip,
    }
    namespace = {"__name__": "__main__", "__builtins__": safe_builtins}
    student_line_events = 0

    def execution_budget(frame, event, _arg):
        nonlocal student_line_events
        if frame.f_code.co_filename == "<student>" and event == "line":
            student_line_events += 1
            if student_line_events > MAX_STUDENT_LINE_EVENTS:
                raise TechCampError("Program exceeded the simulator execution limit.")
        return execution_budget

    previous_trace = sys.gettrace()
    try:
        sys.settrace(execution_budget)
        exec(code, namespace, namespace)
        validate_protocol_trace(raw_trace)
        return {
            "ok": True,
            "actions": normalize_replay_actions(raw_trace),
            "output": output,
            "rawTrace": raw_trace,
        }
    except Exception as error:
        student_line = None
        for frame in traceback.extract_tb(error.__traceback__):
            if frame.filename == "<student>":
                student_line = frame.lineno
        return {
            "ok": False,
            "actions": [],
            "error": {
                "line": getattr(error, "lineno", None) or student_line,
                "message": str(error) or error.__class__.__name__,
            },
            "rawTrace": raw_trace,
        }
    finally:
        sys.settrace(previous_trace)


if __name__ == "__main__":
    try:
        # Node sends request bodies as UTF-8. On Windows, sys.stdin may use
        # the active console code page, which turns Vietnamese source text
        # into a decode error before the student program is even parsed.
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        print(json.dumps(execute(payload), ensure_ascii=True))
    except Exception:
        print(json.dumps({"ok": False, "error": {"message": "The Python runner encountered an internal error."}}))

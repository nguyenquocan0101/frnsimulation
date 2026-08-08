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
    """Require a callable function invoked by the Python main guard."""
    function_defs = [
        node
        for node in tree.body
        if isinstance(node, ast.FunctionDef)
    ]
    if not function_defs:
        raise MainEntrypointError(
            "Define a main function and call it from if __name__ == \"__main__\":.",
            getattr(tree.body[0], "lineno", 1) if tree.body else 1,
        )
    function_names = {node.name for node in function_defs}
    for function in function_defs:
        if function.args.args or function.args.posonlyargs or function.args.kwonlyargs:
            raise MainEntrypointError(
                f"{function.name}() must not require arguments.", function.lineno
            )

    guards = [node for node in tree.body if _is_main_guard(node)]
    if not guards:
        raise MainEntrypointError(
            "Call the main function from if __name__ == \"__main__\":.",
            function_defs[0].lineno,
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
    if calls_function not in function_names:
        raise MainEntrypointError(
            "The __main__ block must call the function defined above.", guard.lineno
        )


class SafetyVisitor(ast.NodeVisitor):
    def visit_Import(self, node):
        raise TechCampError("Only use: from techcamp_api import TechCamp")

    def visit_ImportFrom(self, node):
        allowed = {"TechCamp", "TechCampError"}
        if node.module != "techcamp_api" or any(item.name not in allowed for item in node.names):
            raise TechCampError("Only use: from techcamp_api import TechCamp")

    def visit_Name(self, node):
        if (node.id.startswith("__") and node.id != "__name__") or node.id in FORBIDDEN_NAMES:
            raise TechCampError(f"'{node.id}' is not allowed in the simulator.")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr.startswith("__"):
            raise TechCampError("Attributes beginning with __ are not allowed in the simulator.")
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_NAMES:
            raise TechCampError(f"'{node.func.id}()' is not allowed in the simulator.")
        self.generic_visit(node)


class SimTechCamp:
    def __init__(self, actions, positions):
        self._actions = actions
        self._positions = positions
        self._position = None
        self._low = False
        self._gripping = False

    def _record(self, action_type, **data):
        frame = inspect.currentframe()
        while frame:
            if frame.f_code.co_filename == "<student>":
                data["line"] = frame.f_lineno
                break
            frame = frame.f_back
        self._actions.append({"type": action_type, **data})

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()
        return False

    def move_to(self, position):
        point = normalize_point(position)
        if point not in VALID_POINTS:
            raise TechCampError(f"Invalid position '{position}'. Valid: P1…P7, HOME")
        if self._low:
            self.move_up()
        if self._position != point:
            self._record("move_to", position=point)
        self._position, self._low = point, False
        return True

    def move_down(self):
        if self._position is None or self._position == "HOME":
            raise TechCampError("move_down() requires move_to('P1'..'P7') first.")
        if not self._low:
            self._record("move_down")
        self._low = True
        return True

    def move_up(self):
        if self._position is None:
            return self.move_to("HOME")
        if self._position == "HOME":
            return True
        if self._low:
            self._record("move_up")
        self._low = False
        return True

    def grip(self):
        if not self._gripping:
            self._record("grip")
        self._gripping = True
        return True

    def release(self):
        if self._gripping:
            self._record("release")
        self._gripping = False
        return True

    def get_positions(self):
        return dict(self._positions)

    def get_image(self):
        return {"type": "simulated_board", "positions": self.get_positions()}

    def close(self):
        return True


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

    actions, output = [], []
    raw_positions = payload.get("positions", {})
    if not isinstance(raw_positions, dict):
        raw_positions = {}
    positions = {
        normalize_point(point): bool(value)
        for point, value in raw_positions.items()
        if normalize_point(point) in BLOCK_POINTS
    }

    def classroom_print(*values, sep=" ", end="\n", **_):
        output.append(sep.join(str(value) for value in values) + end)

    def only_techcamp_import(name, *_args, **_kwargs):
        if name != "techcamp_api":
            raise TechCampError("Only techcamp_api may be imported in the simulator.")
        return module

    module = types.ModuleType("techcamp_api")
    module.TechCamp = lambda *args, **kwargs: SimTechCamp(actions, positions)
    module.TechCampError = TechCampError
    safe_builtins = {
        "__import__": only_techcamp_import, "abs": abs, "all": all, "any": any,
        "bool": bool, "dict": dict, "enumerate": enumerate, "float": float,
        "int": int, "len": len, "list": list, "max": max, "min": min,
        "print": classroom_print, "range": range, "round": round, "set": set,
        "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "zip": zip,
    }
    namespace = {"__name__": "__main__", "__builtins__": safe_builtins}
    try:
        exec(code, namespace, namespace)
        return {"ok": True, "actions": actions, "output": output}
    except Exception as error:
        student_line = None
        for frame in traceback.extract_tb(error.__traceback__):
            if frame.filename == "<student>":
                student_line = frame.lineno
        return {"ok": False, "error": {"line": student_line, "message": str(error) or error.__class__.__name__}}


if __name__ == "__main__":
    try:
        # Node sends request bodies as UTF-8. On Windows, sys.stdin may use
        # the active console code page, which turns Vietnamese source text
        # into a decode error before the student program is even parsed.
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        print(json.dumps(execute(payload), ensure_ascii=True))
    except Exception:
        print(json.dumps({"ok": False, "error": {"message": "The Python runner encountered an internal error."}}))

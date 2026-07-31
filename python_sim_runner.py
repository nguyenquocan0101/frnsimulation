"""Isolated Python runner for the FR3 browser simulator; never imports the real robot SDK."""

import ast
import builtins
import inspect
import json
import sys
import traceback
import types

VALID_POINTS = {"P1", "P2", "P3", "P4", "P5", "P6", "P7", "HOMECHESS"}
FORBIDDEN_NAMES = {
    "breakpoint", "compile", "delattr", "dir", "eval", "exec", "getattr",
    "globals", "help", "input", "locals", "open", "setattr", "vars",
}


class TechCampError(Exception):
    pass


class SafetyVisitor(ast.NodeVisitor):
    def visit_Import(self, node):
        raise TechCampError("Chỉ dùng: from techcamp_api import TechCamp")

    def visit_ImportFrom(self, node):
        allowed = {"TechCamp", "TechCampError"}
        if node.module != "techcamp_api" or any(item.name not in allowed for item in node.names):
            raise TechCampError("Chỉ dùng: from techcamp_api import TechCamp")

    def visit_Name(self, node):
        if (node.id.startswith("__") and node.id != "__name__") or node.id in FORBIDDEN_NAMES:
            raise TechCampError(f"'{node.id}' không được phép trong simulator.")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        if node.attr.startswith("__"):
            raise TechCampError("Không dùng thuộc tính bắt đầu bằng __ trong simulator.")
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_NAMES:
            raise TechCampError(f"'{node.func.id}()' không được phép trong simulator.")
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
        point = str(position).upper()
        if point not in VALID_POINTS:
            raise TechCampError(f"Invalid position '{position}'. Valid: P1…P7, HOMECHESS")
        if self._low:
            self.move_up()
        if self._position != point:
            self._record("move_to", position=point)
        self._position, self._low = point, False
        return True

    def move_down(self):
        if self._position is None or self._position == "HOMECHESS":
            raise TechCampError("move_down() requires move_to('P1'..'P7') first.")
        if not self._low:
            self._record("move_down")
        self._low = True
        return True

    def move_up(self):
        if self._position is None or self._position == "HOMECHESS":
            return self.move_to("HOMECHESS")
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
        return {"ok": False, "error": {"message": "Code phải là chuỗi."}}
    try:
        tree = ast.parse(source, filename="<student>", mode="exec")
        SafetyVisitor().visit(tree)
        code = builtins.compile(tree, "<student>", "exec")
    except SyntaxError as error:
        return {"ok": False, "error": {"line": error.lineno, "column": error.offset, "message": error.msg}}
    except TechCampError as error:
        return {"ok": False, "error": {"line": getattr(error, "lineno", None), "message": str(error)}}

    actions, output = [], []
    positions = {point: bool(value) for point, value in payload.get("positions", {}).items() if point in VALID_POINTS}

    def classroom_print(*values, sep=" ", end="\n", **_):
        output.append(sep.join(str(value) for value in values) + end)

    def only_techcamp_import(name, *_args, **_kwargs):
        if name != "techcamp_api":
            raise TechCampError("Chỉ được import techcamp_api trong simulator.")
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
        print(json.dumps(execute(json.load(sys.stdin)), ensure_ascii=True))
    except Exception:
        print(json.dumps({"ok": False, "error": {"message": "Python runner gặp lỗi nội bộ."}}))

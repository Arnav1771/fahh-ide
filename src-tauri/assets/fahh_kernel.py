"""Fahh notebook kernel runner: one per open notebook, started with the chosen interpreter.

    <python> -u fahh_kernel.py <notebook.ipynb>

Needs only ipykernel (which brings jupyter_client). Starts that interpreter's own
ipykernel, then reads JSON commands on stdin, one per line:

    {"op": "run", "cell": "a1b2c3d4", "code": "df.head()"}   (cell: the nbformat 4.5 cell id)
    {"op": "inspect", "id": "k1"}                      (live variables, for Generate code)
    {"op": "interrupt"} | {"op": "restart"} | {"op": "shutdown"}

Several commands may arrive in one write (one per line); they run in order.

and answers with JSON lines on stdout:

    {"type": "ready", "version": "3.11.4"}
    {"type": "missing", "module": "ipykernel"}       (then exits 3)
    {"type": "busy", "cell": "a1b2c3d4"}
    {"type": "output", "cell": "a1b2c3d4", "output": {...nbformat 4 output...}}
    {"type": "clear", "cell": "a1b2c3d4"}
    {"type": "done", "cell": "a1b2c3d4", "count": 7, "status": "ok" | "error", "outputs": [...]}
    {"type": "cancelled", "cells": ["e5f6", "a7b8"]}          (queued runs dropped after an error/interrupt)
    {"type": "inspect", "id": "k1", "vars": [...], "modules": ["import numpy as np"], "error"?: "..."}
    {"type": "restarted"} | {"type": "fatal", "message": "..."}

This runner never writes the .ipynb: the editor is the file's only writer and saves each
`done` cell's outputs into the cell with that id. (The runner used to save by cell index
while the editor saved edits, and the two overwrote each other.)
`inspect` runs silently: no execution count, no history.

Self-check (no ipykernel needed):  python fahh_kernel.py --self-check
"""
import ast
import json
import os
import queue
import sys
import threading
import time

# Runs inside the user's kernel. Defines one dunder helper, hidden from its own listing.
INSPECT_CODE = r'''
def __fahh_inspect__():
    import json, types
    names, mods = [], []
    for name, v in list(globals().items()):
        if name.startswith("_") or name in ("In", "Out", "exit", "quit", "get_ipython", "open"):
            continue
        if isinstance(v, types.ModuleType):
            m = v.__name__
            if m == name:
                mods.append("import " + m)
            elif m.endswith("." + name):
                mods.append("from " + m.rsplit(".", 1)[0] + " import " + name)
            else:
                mods.append("import " + m + " as " + name)
            continue
        t = type(v)
        info = {"name": name, "type": t.__qualname__ if t.__module__ == "builtins" else t.__module__.split(".")[0] + "." + t.__qualname__}
        try:
            if isinstance(v, type):
                info["type"] = "class"
            elif callable(v) and not hasattr(v, "shape"):
                info["type"] = "function"
            elif hasattr(v, "columns") and hasattr(v, "dtypes") and hasattr(v, "head"):
                info["shape"] = list(v.shape)
                info["columns"] = [str(c) for c in list(v.columns)[:40]]
                info["dtypes"] = {str(c): str(d) for c, d in list(v.dtypes.items())[:40]}
                info["head"] = v.head(3).to_string(max_cols=12, max_colwidth=24)[:1200]
            elif hasattr(v, "shape") and hasattr(v, "dtype"):
                info["shape"] = list(v.shape)
                info["dtype"] = str(v.dtype)
            elif isinstance(v, (bool, int, float, complex, str, bytes)):
                info["value"] = repr(v)[:80]
            elif isinstance(v, (list, tuple, dict, set)):
                info["len"] = len(v)
                info["value"] = repr(v)[:80]
        except Exception:
            pass
        names.append(info)
        if len(names) >= 50:
            break
    return json.dumps({"vars": names, "modules": mods[:30]}, default=str)
'''


def _self_check():
    ns = {"x": 3, "rows": [1, 2], "_hidden": 1, "json": json, "dom": __import__("xml.dom").dom}
    exec(INSPECT_CODE, ns)
    # The runner reads the result back from IPython's text/plain repr.
    out = json.loads(ast.literal_eval(repr(ns["__fahh_inspect__"]())))
    names = {v["name"]: v for v in out["vars"]}
    assert names["x"] == {"name": "x", "type": "int", "value": "3"}, names
    assert names["rows"]["len"] == 2 and "_hidden" not in names and "__fahh_inspect__" not in names
    assert "import json" in out["modules"] and "from xml import dom" in out["modules"], out["modules"]
    try:
        import pandas as pd
    except ImportError:
        print("self-check ok (pandas not installed: DataFrame case skipped)")
        return
    ns["df"] = pd.DataFrame({"a": [1, 2, 3, 4], "b": ["x", "y", "z", "w"]})
    df = {v["name"]: v for v in json.loads(ns["__fahh_inspect__"]())["vars"]}["df"]
    assert df["shape"] == [4, 2] and df["columns"] == ["a", "b"] and df["dtypes"]["a"] == "int64", df
    assert len(df["head"].splitlines()) == 4, df["head"]
    print("self-check ok")


if sys.argv[1:] == ["--self-check"]:
    _self_check()
    sys.exit(0)

_out_lock = threading.Lock()


def emit(**event):
    line = json.dumps(event, ensure_ascii=False)
    with _out_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


try:
    from jupyter_client.kernelspec import KernelSpec
    from jupyter_client.manager import KernelManager
    from ipykernel.kernelspec import get_kernel_dict
except ImportError as e:  # jupyter_client comes with ipykernel
    emit(type="missing", module="ipykernel", detail=str(e))
    sys.exit(3)

NOTEBOOK = sys.argv[1]


def start_kernel():
    km = KernelManager()
    # This interpreter's ipykernel, never a "python3" kernelspec registered by some other Python.
    km._kernel_spec = KernelSpec(**get_kernel_dict())
    km.start_kernel(cwd=os.path.dirname(os.path.abspath(NOTEBOOK)) or None)
    kc = km.client()
    kc.start_channels()
    kc.wait_for_ready(timeout=60)
    return km, kc


def to_output(msg_type, c):
    if msg_type == "stream":
        return {"output_type": "stream", "name": c.get("name", "stdout"), "text": c.get("text", "")}
    if msg_type in ("display_data", "execute_result"):
        out = {"output_type": msg_type, "data": c.get("data", {}), "metadata": c.get("metadata", {})}
        if msg_type == "execute_result":
            out["execution_count"] = c.get("execution_count")
        return out
    if msg_type == "error":
        return {"output_type": "error", "ename": c.get("ename", ""), "evalue": c.get("evalue", ""), "traceback": c.get("traceback", [])}
    return None


def execute(km, kc, cell, code):
    emit(type="busy", cell=cell)
    msg_id = kc.execute(code, store_history=True, allow_stdin=False)
    outputs, count, status = [], None, "ok"
    while True:
        try:
            msg = kc.get_iopub_msg(timeout=1)
        except queue.Empty:
            if not km.is_alive():
                emit(type="fatal", message="The kernel died. Restarting it.")
                km.restart_kernel(now=True)
                status = "error"
                break
            continue
        if msg.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        t, c = msg["msg_type"], msg["content"]
        if t == "status" and c.get("execution_state") == "idle":
            break
        if t == "execute_input":
            count = c.get("execution_count")
        elif t == "clear_output":
            outputs = []
            emit(type="clear", cell=cell)
        else:
            out = to_output(t, c)
            if out is not None:
                if t == "error":
                    status = "error"
                outputs.append(out)
                emit(type="output", cell=cell, output=out)
    # The editor owns the .ipynb: it saves these into the cell with this id. Two writers
    # (this runner by cell index, the editor for edits) used to overwrite each other.
    emit(type="done", cell=cell, count=count, status=status, outputs=outputs)
    return status


def inspect(kc, req_id):
    """Variables and imports of the live kernel, run silently (no count, no history, not saved)."""
    msg_id = kc.execute(INSPECT_CODE, silent=True, store_history=False, allow_stdin=False, user_expressions={"r": "__fahh_inspect__()"})
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            reply = kc.get_shell_msg(timeout=1)
        except queue.Empty:
            continue
        if reply.get("parent_header", {}).get("msg_id") != msg_id:
            continue  # an earlier cell's reply: the runner never reads those
        r = reply.get("content", {}).get("user_expressions", {}).get("r", {})
        try:
            state = json.loads(ast.literal_eval(r["data"]["text/plain"]))
            emit(type="inspect", id=req_id, vars=state.get("vars", []), modules=state.get("modules", []))
        except Exception:  # noqa: BLE001
            emit(type="inspect", id=req_id, vars=[], modules=[], error=r.get("evalue") or r.get("ename") or "could not read the kernel state")
        return
    emit(type="inspect", id=req_id, vars=[], modules=[], error="the kernel did not answer")


def main():
    try:
        km, kc = start_kernel()
    except Exception as e:  # noqa: BLE001
        emit(type="fatal", message=f"Could not start the kernel: {e}")
        sys.exit(4)
    emit(type="ready", version=".".join(map(str, sys.version_info[:3])))

    work = queue.Queue()

    def drop_queued():
        dropped = []
        while True:
            try:
                item = work.get_nowait()
            except queue.Empty:
                break
            if item.get("op") == "run":
                dropped.append(item["cell"])
            else:
                work.put(item)  # keep restart/shutdown
                break
        if dropped:
            emit(type="cancelled", cells=dropped)

    def read_stdin():
        for line in sys.stdin:
            try:
                cmd = json.loads(line)
            except ValueError:
                continue
            op = cmd.get("op")
            if op == "interrupt":
                drop_queued()
                km.interrupt_kernel()
            elif op == "restart":
                drop_queued()
                km.interrupt_kernel()
                work.put(cmd)
            else:
                work.put(cmd)
        work.put({"op": "shutdown"})  # the editor went away

    threading.Thread(target=read_stdin, daemon=True).start()

    while True:
        cmd = work.get()
        op = cmd.get("op")
        if op == "run":
            if execute(km, kc, str(cmd["cell"]), cmd.get("code", "")) == "error":
                drop_queued()  # like Jupyter: Run all stops at the first error
        elif op == "inspect":
            inspect(kc, str(cmd.get("id", "")))
        elif op == "restart":
            km.restart_kernel(now=True)
            kc.wait_for_ready(timeout=60)
            emit(type="restarted")
        elif op == "shutdown":
            break
    kc.stop_channels()
    km.shutdown_kernel(now=True)


if __name__ == "__main__":
    main()

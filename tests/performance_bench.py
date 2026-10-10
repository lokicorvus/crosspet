"""Fresh WebKit processes per mode/pose, 5 s warmup and 20 s CPU sampling.

Measures the renderer harness, not the complete desktop app. Each helper must
be newly spawned during the trial. GPU and Networking cache paths must match
the benchmark bundle; WebContent is paired by launch time and process type.
"""
import json
import os
import plistlib
import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build'
BUNDLE_ID = 'io.github.crosspet.performance-benchmark'
APP = BUILD / 'PerformanceBenchmark.app'
EXE = APP / 'Contents/MacOS/PerformanceBenchmark'


def run(args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL)


def webkit():
    return {int(line.split(None, 1)[0]) for line in run(['ps', '-axo', 'pid=,comm=']).splitlines() if '/com.apple.WebKit.' in line}


def cpu_seconds(pids):
    rows = run(['ps', '-p', ','.join(map(str, pids)), '-o', 'pid=,time=']).splitlines()
    result = {}
    for row in rows:
        pid, elapsed = row.split()
        pieces = elapsed.split(':')
        result[int(pid)] = sum(float(v) * 60**i for i, v in enumerate(reversed(pieces)))
    assert set(result) == set(pids), 'a benchmark process exited during sampling'
    return result


def main():
    EXE.parent.mkdir(parents=True, exist_ok=True)
    (APP / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': BUNDLE_ID, 'CFBundleName': 'PerformanceBenchmark', 'CFBundleExecutable':'PerformanceBenchmark', 'CFBundlePackageType':'APPL', 'LSUIElement':True}))
    subprocess.run(['swiftc', '-parse-as-library', '-O', '-module-cache-path', str(BUILD/'module-cache'), str(ROOT/'tests/PerformanceBench.swift'), '-o', str(EXE), '-framework','Cocoa','-framework','WebKit'], check=True)
    subprocess.run(['codesign','--force','--deep','-s','-',str(APP)], check=True, capture_output=True)
    results = []
    for pose in ['idle','reading']:
        for mode in ['full','balanced','eco']:
            old = webkit()
            ready = BUILD / f'bench-{pose}-{mode}.pid'
            ready.unlink(missing_ok=True)
            log = (BUILD / f'bench-{pose}-{mode}.log').open('w')
            proc = subprocess.Popen([str(EXE),str(ROOT),mode,pose,str(ready)], stdout=log, stderr=log)
            pid = proc.pid
            try:
                deadline = time.monotonic()+15
                while not ready.exists():
                    assert proc.poll() is None and time.monotonic()<deadline, 'benchmark failed to initialize; inspect per-trial log'
                    time.sleep(.1)
                pid = int(ready.read_text())
                helpers = webkit()-old
                assert len(helpers)==3, f'expected three new WebKit helpers, got {helpers}'
                kinds = {}
                for helper in helpers:
                    kind = Path(run(['ps','-ww','-p',str(helper),'-o','comm=']).strip()).name
                    kinds[kind] = helper
                    if kind != 'com.apple.WebKit.WebContent':
                        assert BUNDLE_ID in run(['lsof','-p',str(helper)]), f'unverified helper cache ownership: {helper}'
                assert set(kinds)=={'com.apple.WebKit.GPU','com.apple.WebKit.WebContent','com.apple.WebKit.Networking'}
                pids = [pid,*sorted(helpers)]
                start = time.monotonic(); first = cpu_seconds(pids)
                time.sleep(20)
                last = cpu_seconds(pids); elapsed = time.monotonic()-start
                memfile = BUILD / f'bench-{pose}-{mode}-footprint.json'
                subprocess.run(['footprint','-j',str(memfile),'--noCategories',*map(str,pids)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                memory = json.loads(memfile.read_text())
                footprint = sum(p['footprint'] for p in memory['processes'])
                item = {'mode':mode,'pose':pose,'pids':pids,'duration_seconds':round(elapsed,3),'average_cpu_percent':round(100*sum(last[p]-first[p] for p in pids)/elapsed,2),'footprint_mib':round(footprint/1024**2,2),'cpu_start':first,'cpu_end':last}
                results.append(item)
                (BUILD/'performance-benchmark.json').write_text(json.dumps({'kind':'isolated WebKit renderer','window_points':[260,362],'aura':'on','warmup_seconds':5,'measurement_seconds':20,'results':results}, indent=2)+'\n')
                print(f'{mode}/{pose}: CPU {item["average_cpu_percent"]}% · footprint {item["footprint_mib"]} MiB', flush=True)
            finally:
                if proc.poll() is None:
                    assert run(['ps','-ww','-p',str(pid),'-o','comm=']).strip()==str(EXE), 'refusing to signal unrelated process'
                    proc.terminate(); proc.wait(timeout=5)
                    time.sleep(2)
                log.close()
    print('PASS: six fresh-process trials; isolated helper set and cache ownership checked', flush=True)

if __name__ == '__main__':
    main()

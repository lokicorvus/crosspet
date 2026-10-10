"""Compile the real App for tests with an isolated preferences domain."""
import re
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
build = root / 'build'
build.mkdir(exist_ok=True)
s = (root/'app/CrossPet.swift').read_text()
s = s.replace('let defaults = UserDefaults.standard', 'let defaults = UserDefaults(suiteName: "io.github.crosspet.performance-tests")!')
if '@main\nstruct CrossPetMain' in s:
    s = re.sub(r'@main\nstruct CrossPetMain \{.*?\n\}\n', '', s, flags=re.S)
else:
    s = s.replace('let app = NSApplication.shared\nlet delegate = App()\napp.delegate = delegate\napp.setActivationPolicy(.accessory)\napp.run()\n', '')
source = build/'NativeAppForTests.swift'
source.write_text(s)
args = ['swiftc','-parse-as-library','-module-cache-path',str(build/'module-cache'),str(source),str(root/'tests/NativePerformanceTests.swift')]
args += [str(root/'app/HostLifecycle.swift')]
args += ['-o',str(build/'native-performance-tests'),'-framework','Cocoa','-framework','WebKit','-framework','ServiceManagement']
subprocess.run(args,check=True)
subprocess.run([str(build/'native-performance-tests')],check=True)

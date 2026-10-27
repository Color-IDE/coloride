"""Collect notices for the installed host dependency closure, excluding build tools."""
import importlib.metadata as metadata
from packaging.requirements import Requirement

pending = ['coloride-desktop-backend']
seen = set()
while pending:
    name = pending.pop()
    distribution = metadata.distribution(name)
    canonical = distribution.metadata['Name'].lower().replace('_', '-')
    if canonical in seen:
        continue
    seen.add(canonical)
    for raw in distribution.requires or []:
        requirement = Requirement(raw)
        if not requirement.marker or requirement.marker.evaluate({'extra': ''}):
            pending.append(requirement.name)
    if canonical == 'coloride-desktop-backend':
        continue
    print('\n## Python: ' + distribution.metadata['Name'] + ' ' + distribution.version)
    found = False
    for entry in distribution.files or []:
        if not entry.name.lower().startswith(('license', 'licence', 'copying', 'notice')):
            continue
        file = distribution.locate_file(entry)
        if not file.is_file():
            continue
        data = file.read_bytes()
        if b'\0' in data:
            continue
        print('\n### ' + entry.name + '\n\n' + data.decode('utf-8', errors='replace'))
        found = True
    if not found:
        raise RuntimeError('No license text supplied for runtime dependency: ' + canonical)

"""Collect notices for the installed host dependency closure, excluding build tools."""
import importlib.metadata as metadata
from packaging.requirements import Requirement

pending = [('coloride-desktop-backend', frozenset())]
seen = set()
distributions = {}
while pending:
    name, extras = pending.pop()
    distribution = metadata.distribution(name)
    canonical = distribution.metadata['Name'].lower().replace('_', '-')
    state = (canonical, extras)
    if state in seen:
        continue
    seen.add(state)
    distributions[canonical] = distribution
    for raw in distribution.requires or []:
        requirement = Requirement(raw)
        if not requirement.marker or any(
            requirement.marker.evaluate({'extra': extra}) for extra in {'', *extras}
        ):
            pending.append((requirement.name, frozenset(requirement.extras)))

for canonical, distribution in sorted(distributions.items()):
    if canonical == 'coloride-desktop-backend':
        continue
    print('\n## Python: ' + distribution.metadata['Name'] + ' ' + distribution.version)
    found = False
    for entry in distribution.files or []:
        if not entry.name.lower().startswith(('license', 'licence', 'copying', 'notice')):
            continue
        if entry.suffix in {'.py', '.pyc', '.so', '.pyd'}:
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

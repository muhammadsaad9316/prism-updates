"""Fetch a release artifact on GitHub without an operator login token."""
import hashlib
import io
import os
from pathlib import Path
import re
import sys
import urllib.request
from urllib.parse import urlsplit
import zipfile

def unpack(data, digest, destination):
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Artifact digest does not match the approved GitHub build')
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        if {item.filename for item in entries} != {'app-release.apk', 'latest.json'} or len(entries) != 2:
            raise ValueError('Unexpected release artifact contents')
        for item in entries:
            limit = 33554432 if item.filename.endswith('.apk') else 65536
            if item.file_size < 1 or item.file_size > limit:
                raise ValueError('Release artifact exceeds allowed size')
        destination = Path(destination)
        destination.mkdir(parents=True, exist_ok=True)
        for item in entries:
            (destination / item.filename).write_bytes(archive.read(item))

def main():
    url = os.environ['ARTIFACT_URL']
    print('::add-mask::' + url, flush=True)
    parts = urlsplit(url)
    if parts.scheme != 'https' or not re.fullmatch(r'productionresultssa[0-9]+\.blob\.core\.windows\.net', parts.hostname or '') or parts.username or parts.password:
        raise ValueError('Only a GitHub Actions artifact storage URL is allowed')
    request = urllib.request.Request(url, method='GET')
    with urllib.request.urlopen(request, timeout=90) as response:
        final = urlsplit(response.url)
        if final.hostname != parts.hostname or final.scheme != 'https':
            raise ValueError('Unexpected artifact redirect')
        data = response.read(50331649)
    if len(data) > 50331648:
        raise ValueError('Artifact archive is too large')
    unpack(data, os.environ['ARTIFACT_SHA256'], sys.argv[1])
    print('Approved artifact archive verified and unpacked on GitHub.')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Artifact retrieval failed validation or its short-lived link expired.', file=sys.stderr)
        raise SystemExit(1)

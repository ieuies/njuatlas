Set-Location $PSScriptRoot\..\backend
python -m pip install -q -r requirements-dev.txt
python -m pytest @args

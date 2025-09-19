#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

log "🔧 Preparing Fusebox dev environment"

if [[ ! -d "${ROOT_DIR}/sam_env" ]]; then
  log "❌ Python venv not found at ${ROOT_DIR}/sam_env"
  log "   Run: python3 -m venv sam_env && source sam_env/bin/activate && pip install -e ."
  exit 1
fi

source "${ROOT_DIR}/sam_env/bin/activate"

PYTHON_EXE="${ROOT_DIR}/sam_env/bin/python"
HELPER_PATH="${ROOT_DIR}/build/dicom-reg-converter/dicom_reg_to_h5"

if [[ ! -x "${HELPER_PATH}" ]]; then
  log "❌ DICOM helper not found at ${HELPER_PATH}"
  log "   Run: cmake --build build/dicom-reg-converter"
  exit 1
fi

log "🧪 Checking SimpleITK availability"
if ! "${PYTHON_EXE}" - <<'PY' >/dev/null 2>&1;
import SimpleITK
import sys
req = (2, 3, 0)
parts = tuple(int(p) for p in SimpleITK.__version__.split('.')[:3])
sys.exit(0 if parts >= req else 1)
PY
then
  log "⬆️  Installing/Upgrading SimpleITK (requires internet access)"
  pip install --upgrade SimpleITK >/dev/null
else
  log "✅ SimpleITK present"
fi

export DICOM_REG_CONVERTER="${HELPER_PATH}"
export FUSEBOX_PYTHON="${PYTHON_EXE}"

log "🚀 Launching dev server with Fusebox helper"
cd "${ROOT_DIR}"
exec npm run dev:itk

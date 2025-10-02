export interface ViewerBootstrapResult {
  studyData: { studies: any[]; patient?: any } | null;
  currentStudy: any | null;
  patientDbId: string | null;
}

interface ViewerBootstrapParams {
  studies: any[] | null | undefined;
  studyIdParam?: string | null;
  patientIdParam?: string | null;
}

async function fetchPatientsSafely(): Promise<any[]> {
  try {
    const response = await fetch('/api/patients');
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn('[viewer-bootstrap] Failed to fetch patients', error);
    return [];
  }
}

export async function resolveViewerBootstrap(
  { studies, studyIdParam, patientIdParam }: ViewerBootstrapParams,
): Promise<ViewerBootstrapResult> {
  const safeStudies = Array.isArray(studies) ? studies : [];

  if (!safeStudies.length) {
    return { studyData: null, currentStudy: null, patientDbId: null };
  }

  const toStringOrNull = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    const num = Number(value);
    return Number.isFinite(num) ? String(num) : null;
  };

  const buildPatientInfo = (study: any) => (
    study?.patientId != null
      ? {
          id: study.patientId,
          patientID: study.patientID,
          patientName: study.patientName,
        }
      : undefined
  );

  if (studyIdParam) {
    const studyIdNumber = Number(studyIdParam);
    const selectedStudy = safeStudies.find((s: any) => Number(s.id) === studyIdNumber);
    if (selectedStudy) {
      const relatedStudies = safeStudies.filter((s: any) => s.patientId === selectedStudy.patientId);
      return {
        studyData: {
          studies: relatedStudies.length ? relatedStudies : [selectedStudy],
          patient: buildPatientInfo(selectedStudy),
        },
        currentStudy: selectedStudy,
        patientDbId: toStringOrNull(selectedStudy.patientId),
      };
    }
  }

  if (patientIdParam) {
    const studiesByPatientIdentifier = safeStudies.filter(
      (s: any) => String(s.patientID) === patientIdParam,
    );
    if (studiesByPatientIdentifier.length) {
      return {
        studyData: { studies: studiesByPatientIdentifier },
        currentStudy: studiesByPatientIdentifier[0],
        patientDbId: toStringOrNull(studiesByPatientIdentifier[0]?.patientId),
      };
    }

    const patients = await fetchPatientsSafely();
    if (patients.length) {
      const matchedPatient = patients.find((p: any) => String(p.patientID) === patientIdParam);
      if (matchedPatient) {
        const patientStudies = safeStudies.filter(
          (s: any) => Number(s.patientId) === Number(matchedPatient.id),
        );
        if (patientStudies.length) {
          return {
            studyData: { studies: patientStudies, patient: matchedPatient },
            currentStudy: patientStudies[0],
            patientDbId: toStringOrNull(matchedPatient.id),
          };
        }
      }
    }
  }

  const defaultStudy = safeStudies[0];
  if (defaultStudy) {
    return {
      studyData: { studies: [defaultStudy], patient: buildPatientInfo(defaultStudy) },
      currentStudy: defaultStudy,
      patientDbId: toStringOrNull(defaultStudy.patientId),
    };
  }

  return { studyData: null, currentStudy: null, patientDbId: null };
}

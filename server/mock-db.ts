// Mock database for demonstration
// This simulates database operations in memory

interface MockPatient {
  id: number;
  patientID: string;
  patientName: string;
  dateOfBirth?: string;
  patientSex?: string;
  patientAge?: string;
  createdAt: Date;
}

interface MockStudy {
  id: number;
  patientId: number;
  studyInstanceUID: string;
  studyDate?: Date;
  studyDescription?: string;
  createdAt: Date;
}

interface MockSeries {
  id: number;
  studyId: number;
  seriesInstanceUID: string;
  seriesDescription?: string;
  modality?: string;
  seriesNumber?: number;
  createdAt: Date;
}

// In-memory storage
const mockData = {
  patients: [
    {
      id: 1,
      patientID: 'DEMO-001',
      patientName: 'Demo Patient One',
      dateOfBirth: '1980-01-01',
      patientSex: 'M',
      patientAge: '44',
      createdAt: new Date('2024-01-01')
    },
    {
      id: 2,
      patientID: 'DEMO-002', 
      patientName: 'Demo Patient Two',
      dateOfBirth: '1975-06-15',
      patientSex: 'F',
      patientAge: '49',
      createdAt: new Date('2024-01-02')
    }
  ] as MockPatient[],
  studies: [
    {
      id: 1,
      patientId: 1,
      studyInstanceUID: '1.2.3.4.5.6.7.8.9.1',
      studyDate: new Date('2024-01-15'),
      studyDescription: 'CT Head without Contrast',
      createdAt: new Date('2024-01-15')
    },
    {
      id: 2,
      patientId: 1,
      studyInstanceUID: '1.2.3.4.5.6.7.8.9.2',
      studyDate: new Date('2024-02-01'),
      studyDescription: 'MRI Brain with Contrast',
      createdAt: new Date('2024-02-01')
    }
  ] as MockStudy[],
  series: [
    {
      id: 1,
      studyId: 1,
      seriesInstanceUID: '1.2.3.4.5.6.7.8.9.1.1',
      seriesDescription: 'Axial CT Brain',
      modality: 'CT',
      seriesNumber: 1,
      createdAt: new Date('2024-01-15')
    },
    {
      id: 2,
      studyId: 2,
      seriesInstanceUID: '1.2.3.4.5.6.7.8.9.2.1',
      seriesDescription: 'T1 Axial',
      modality: 'MR',
      seriesNumber: 1,
      createdAt: new Date('2024-02-01')
    }
  ] as MockSeries[]
};

// Mock database operations
export const mockDb = {
  select: () => ({
    from: (table: string) => ({
      where: (condition: any) => ({
        limit: (n: number) => {
          if (table === 'patients') return mockData.patients.slice(0, n);
          if (table === 'studies') return mockData.studies.slice(0, n);
          if (table === 'series') return mockData.series.slice(0, n);
          return [];
        }
      }),
      orderBy: (order: any) => {
        if (table === 'patients') return mockData.patients;
        if (table === 'studies') return mockData.studies;
        if (table === 'series') return mockData.series;
        return [];
      }
    })
  }),
  insert: (table: string) => ({
    values: (data: any) => ({
      returning: () => {
        const newItem = { ...data, id: Date.now(), createdAt: new Date() };
        if (table === 'patients') {
          mockData.patients.push(newItem as MockPatient);
          return [newItem];
        }
        return [newItem];
      }
    })
  })
};

console.log('🎭 Using mock database with demo data');
console.log(`📊 Loaded: ${mockData.patients.length} patients, ${mockData.studies.length} studies, ${mockData.series.length} series`);
# Superbeam Production Backend Improvements

## 1. Enhanced Patient Management

### Current Issue
- Patient creation uses try/catch for existence check (unreliable)
- No handling of patient merging scenarios
- Missing patient de-identification features

### Recommended Solution
```javascript
// Better patient lookup/creation
async function findOrCreatePatient(metadata, patientData) {
  // First, explicitly check if patient exists
  const existingPatient = await storage.getPatientByID(metadata.patientID);
  
  if (existingPatient) {
    // Update patient info if more complete data available
    if (!existingPatient.patientName && metadata.patientName) {
      await storage.updatePatientMetadata(existingPatient.id, {
        patientName: metadata.patientName
      });
    }
    return existingPatient;
  }
  
  // Create new patient with proper validation
  return await storage.createPatient({
    patientID: metadata.patientID || generatePatientID(),
    patientName: metadata.patientName || 'Unknown Patient',
    patientSex: metadata.patientSex,
    patientAge: metadata.patientAge,
    dateOfBirth: metadata.patientBirthDate
  });
}
```

## 2. Duplicate Prevention System

### Add to Schema
```sql
-- Add unique constraint on image files
ALTER TABLE images ADD COLUMN file_hash VARCHAR(64);
CREATE UNIQUE INDEX idx_unique_image ON images(sop_instance_uid, file_hash);
```

### Implementation
```javascript
import crypto from 'crypto';

async function calculateFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  
  return hash.digest('hex');
}

// Check before creating image
const fileHash = await calculateFileHash(file.path);
const existingImage = await storage.getImageByHash(fileHash);

if (existingImage) {
  console.log(`Skipping duplicate image: ${file.originalname}`);
  fs.unlinkSync(file.path); // Clean up temp file
  continue;
}
```

## 3. Transaction Support

### Database Transactions
```javascript
async function processUploadWithTransaction(files, patientData) {
  return await db.transaction(async (tx) => {
    const results = [];
    
    try {
      // All database operations within transaction
      for (const file of files) {
        // Process file...
      }
      
      // Move files only after successful DB operations
      await moveFilesToPermanentStorage(processedFiles);
      
      return results;
    } catch (error) {
      // Rollback happens automatically
      // Clean up any moved files
      await cleanupFailedUpload(processedFiles);
      throw error;
    }
  });
}
```

## 4. File Storage Improvements

### Current Issues
- Files stored on local filesystem
- No backup/redundancy
- No CDN support
- File paths hardcoded in database

### Production Solution
```javascript
// Abstract file storage interface
interface FileStorage {
  save(file: Buffer, path: string): Promise<string>;
  get(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  getUrl(path: string): string;
}

// S3 Implementation
class S3Storage implements FileStorage {
  async save(file: Buffer, path: string): Promise<string> {
    const key = `dicom/${path}`;
    await s3.putObject({
      Bucket: process.env.S3_BUCKET,
      Key: key,
      Body: file,
      ContentType: 'application/dicom'
    }).promise();
    return key;
  }
  
  getUrl(path: string): string {
    return s3.getSignedUrl('getObject', {
      Bucket: process.env.S3_BUCKET,
      Key: path,
      Expires: 3600
    });
  }
}
```

## 5. Metadata Validation

### DICOM Compliance
```javascript
const REQUIRED_DICOM_TAGS = {
  patientID: '0010,0020',
  studyInstanceUID: '0020,000D',
  seriesInstanceUID: '0020,000E',
  sopInstanceUID: '0008,0018',
  modality: '0008,0060'
};

function validateDICOMMetadata(metadata) {
  const errors = [];
  
  for (const [field, tag] of Object.entries(REQUIRED_DICOM_TAGS)) {
    if (!metadata[field]) {
      errors.push(`Missing required DICOM tag ${tag} (${field})`);
    }
  }
  
  // Validate UID format (1.2.xxx)
  const uidPattern = /^[0-9]+(\.[0-9]+)*$/;
  if (metadata.studyInstanceUID && !uidPattern.test(metadata.studyInstanceUID)) {
    errors.push('Invalid Study Instance UID format');
  }
  
  return errors;
}
```

## 6. Audit Trail

### Add Audit Table
```sql
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action VARCHAR(50) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id INTEGER,
  details JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Implementation
```javascript
async function logAuditEvent(action, resourceType, resourceId, details, req) {
  await storage.createAuditLog({
    userId: req.user?.id,
    action,
    resourceType,
    resourceId,
    details,
    ipAddress: req.ip,
  });
}

// Usage
await logAuditEvent('upload', 'study', study.id, {
  patientID: patient.patientID,
  filesCount: files.length,
  totalSize: totalBytes
}, req);
```

## 7. Performance Optimizations

### Batch Processing
```javascript
// Instead of individual inserts
const imagesToInsert = [];
for (const imageData of images) {
  imagesToInsert.push(imageData);
}

// Batch insert
await db.insert(images).values(imagesToInsert);
```

### Indexing Strategy
```sql
-- Add indexes for common queries
CREATE INDEX idx_studies_patient_id ON studies(patient_id);
CREATE INDEX idx_series_study_id ON series(study_id);
CREATE INDEX idx_images_series_id ON images(series_id);
CREATE INDEX idx_images_slice_location ON images(series_id, slice_location);
```

## 8. Error Handling & Recovery

### Graceful Degradation
```javascript
class UploadQueue {
  private queue: Map<string, UploadJob> = new Map();
  
  async addJob(files: File[], metadata: any): Promise<string> {
    const jobId = generateUID();
    
    this.queue.set(jobId, {
      id: jobId,
      files,
      metadata,
      status: 'pending',
      attempts: 0,
      createdAt: new Date()
    });
    
    // Process async
    this.processJob(jobId);
    
    return jobId;
  }
  
  async processJob(jobId: string) {
    const job = this.queue.get(jobId);
    if (!job) return;
    
    try {
      job.status = 'processing';
      await processUploadWithTransaction(job.files, job.metadata);
      job.status = 'completed';
    } catch (error) {
      job.attempts++;
      job.lastError = error.message;
      
      if (job.attempts < 3) {
        // Retry with exponential backoff
        setTimeout(() => this.processJob(jobId), Math.pow(2, job.attempts) * 1000);
      } else {
        job.status = 'failed';
      }
    }
  }
}
```

## 9. Multi-Tenancy Support

### Schema Changes
```sql
-- Add organization support
CREATE TABLE organizations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  settings JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE patients ADD COLUMN organization_id INTEGER REFERENCES organizations(id);
ALTER TABLE users ADD COLUMN organization_id INTEGER REFERENCES organizations(id);

-- Row-level security
CREATE POLICY patient_isolation ON patients
  FOR ALL USING (organization_id = current_setting('app.organization_id')::INTEGER);
```

## 10. DICOM Network Support

### DIMSE C-STORE SCP
```javascript
import { Server } from 'dicom-dimse';

const scpServer = new Server({
  port: 11112,
  ae_title: 'SUPERBEAM',
  promiscuous: false,
  
  onCStore: async (request, callback) => {
    try {
      // Extract metadata
      const metadata = extractDICOMMetadata(request.dataset);
      
      // Process through standard upload pipeline
      await processIncomingDICOM(request.dataset, metadata);
      
      callback({ status: 0x0000 }); // Success
    } catch (error) {
      callback({ status: 0xC000 }); // Failed
    }
  }
});
```

## Summary

These improvements would make Superbeam production-ready for healthcare environments:

1. **Data Integrity**: Transactions, duplicate prevention, validation
2. **Scalability**: S3 storage, batch processing, proper indexing
3. **Security**: Audit trails, multi-tenancy, row-level security
4. **Reliability**: Error recovery, retry mechanisms, graceful degradation
5. **Compliance**: DICOM validation, de-identification support
6. **Integration**: DICOM network support, PACS compatibility

The system would then be ready for:
- Multiple concurrent users
- Large-scale data ingestion
- Healthcare compliance requirements
- Integration with existing PACS/RIS systems
- Cloud deployment with auto-scaling
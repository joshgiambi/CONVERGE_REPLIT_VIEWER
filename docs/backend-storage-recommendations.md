# Backend Storage Recommendations for DICOM Medical Imaging System

## Current Architecture
- **Filesystem Storage**: DICOM files stored at `storage/patients/{patientId}/{studyUID}/{seriesUID}/{sopUID}.dcm`
- **PostgreSQL Database**: Metadata, patient info, studies, series, RT structures
- **Challenges**: Complex upload flow, scalability concerns, large file management

## Recommended Solution: Hybrid Storage Architecture

### 1. PostgreSQL (Keep Current)
**Best for structured data and metadata:**
- Patient records and demographics
- Study/series metadata and relationships
- RT structures and contours (JSON/JSONB for complex geometry)
- Thumbnails and previews (already implemented)
- Search indexes and queries
- User sessions and authentication
- Audit logs and history

**Advantages:**
- ACID compliance for medical data integrity
- Complex queries for patient/study searches
- Relationships between entities
- Already implemented and working well

### 2. Object Storage (Future Enhancement)
**Best for binary DICOM files:**
- Raw DICOM file storage
- Large imaging datasets
- Compressed archives
- Generated reports and exports

**Implementation Options:**

#### Option A: Replit Object Storage (When Ready)
- Native integration with Replit platform
- Automatic backup and redundancy
- No additional configuration needed
- Cost-effective for moderate usage

#### Option B: Cloud Storage Services
- **AWS S3**: Industry standard, HIPAA compliant options
- **Google Cloud Storage**: Good for medical imaging workloads
- **Azure Blob Storage**: Healthcare-specific compliance features

### 3. Hybrid Caching Layer (Optional)
**For performance optimization:**
- Redis/Memcached for frequently accessed metadata
- CDN for serving anonymized preview images
- Local filesystem cache for active working sets

## Implementation Phases

### Phase 1: Immediate Improvements (Current)
✅ Simplified upload UX with clear status flow
✅ Dedicated upload page at `/upload`
✅ Auto-import after processing
✅ Clear progress indicators

### Phase 2: Storage Optimization (Next)
- [ ] Implement file chunking for large uploads
- [ ] Add compression for archived studies
- [ ] Create cleanup policies for temporary files
- [ ] Implement background job processing

### Phase 3: Object Storage Migration (Future)
- [ ] Set up object storage bucket
- [ ] Migrate existing files gradually
- [ ] Update file serving endpoints
- [ ] Implement signed URLs for secure access

### Phase 4: Advanced Features
- [ ] Multi-tier storage (hot/cold)
- [ ] Automatic archival policies
- [ ] Distributed caching
- [ ] Load balancing for multiple storage backends

## Storage Sizing Estimates

### Current Filesystem Approach
- **Small Clinic**: 1-5 TB (manageable)
- **Medium Hospital**: 10-50 TB (needs optimization)
- **Large Institution**: 100+ TB (requires object storage)

### Typical DICOM File Sizes
- **CT Study**: 100-500 MB
- **MRI Study**: 200-800 MB
- **PET/CT**: 500 MB - 2 GB
- **RT Structure Set**: 1-10 MB

## Security Considerations

### Data Protection
- Encryption at rest (filesystem or object storage)
- Encryption in transit (HTTPS/TLS)
- Access control lists (ACLs)
- Audit logging for all access

### Compliance
- HIPAA compliance for US healthcare
- GDPR for European patients
- Local healthcare regulations
- Data retention policies

## Cost Analysis

### Current (Filesystem)
- **Storage**: $0.10-0.20/GB/month
- **Backup**: Additional 50-100% cost
- **Pros**: Simple, no API costs
- **Cons**: Scaling limitations, backup complexity

### Object Storage
- **Storage**: $0.02-0.05/GB/month
- **API Calls**: $0.0004 per 1000 requests
- **Bandwidth**: $0.01-0.09/GB
- **Pros**: Scalable, built-in redundancy
- **Cons**: API complexity, egress costs

## Recommended Migration Path

1. **Keep current architecture** for now (working well)
2. **Monitor storage growth** and performance
3. **When reaching 5-10 TB**, begin object storage planning
4. **Implement gradually** with new uploads first
5. **Migrate existing data** in background batches

## Technical Implementation Notes

### File Service Pattern
```javascript
// Current: Direct filesystem
const filePath = `storage/patients/${patientId}/${studyUID}/${seriesUID}/${sopUID}.dcm`;
return fs.createReadStream(filePath);

// Future: Object storage with fallback
const objectKey = `patients/${patientId}/${studyUID}/${seriesUID}/${sopUID}.dcm`;
try {
  return await objectStorage.getStream(objectKey);
} catch {
  // Fallback to filesystem during migration
  return fs.createReadStream(legacyPath);
}
```

### Database Schema Adaptation
```sql
-- Add storage location tracking
ALTER TABLE images ADD COLUMN storage_backend VARCHAR(20) DEFAULT 'filesystem';
ALTER TABLE images ADD COLUMN storage_path TEXT;
ALTER TABLE images ADD COLUMN storage_url TEXT;
```

## Conclusion

The current filesystem + PostgreSQL approach is adequate for small to medium deployments. As the system grows, implementing object storage will become necessary for scalability and cost efficiency. The recommended hybrid approach provides the best balance of performance, cost, and maintainability for medical imaging workloads.
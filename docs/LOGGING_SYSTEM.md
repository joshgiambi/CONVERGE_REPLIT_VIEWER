# Centralized Logging System

## Overview

The application uses a centralized logging system that routes all logs through a unified interface. This provides consistent formatting, debug event capture, and environment-aware log levels.

## Architecture

### Core Components

1. **[server/logger.ts](../server/logger.ts)** - Main logging service
   - Environment-aware log levels (debug/info/warn/error)
   - ISO timestamp formatting
   - Source tagging for log origin tracking
   - Integration with debug-hub for event capture

2. **[server/debug/debug-hub.ts](../server/debug/debug-hub.ts)** - Debug event storage
   - In-memory event buffering
   - Structured event capture with level, source, and message
   - API endpoints for retrieving debug history

3. **[client/src/lib/log.ts](../client/src/lib/log.ts)** - Client-side logging
   - Browser console integration
   - Consistent interface with server logging

## Usage

### Server-Side Logging

```typescript
import { logger } from './logger';

// Basic logging
logger.info('Server started', 'server');
logger.debug('Processing request', 'routes');
logger.warn('Deprecated API used', 'api');
logger.error('Database connection failed', 'db');

// With source tags for filtering
logger.info('Fusebox run started', 'fusebox');
logger.debug(`Processing ${fileCount} files`, 'upload');
```

### Client-Side Logging

```typescript
import { log } from '@/lib/log';

log('User action', data);
log.warn('Performance degradation detected');
log.error('Failed to load image', error);
```

## Log Levels

Controlled by `LOG_LEVEL` environment variable (default: `info` in development, `warn` in production):

- **debug** (10): Detailed diagnostic information
- **info** (20): General informational messages
- **warn** (30): Warning messages for potentially harmful situations
- **error** (40): Error events that might still allow the application to continue
- **silent** (50): No logging output

## Source Tags

Common source tags used throughout the application:

- `server` - Main server operations
- `routes` - HTTP route handlers
- `upload` - File upload processing
- `fusebox` - Fusion processing operations
- `rtstruct` - RT structure parsing
- `db` - Database operations
- `dicom` - DICOM parsing and processing
- `manifest` - Fusion manifest service
- `debug` - Debug hub events

## Debug Hub API

The debug hub provides endpoints for retrieving captured events:

```bash
# Get all debug events
GET /api/debug/events

# Get events filtered by level
GET /api/debug/events?level=error

# Get events filtered by source
GET /api/debug/events?source=fusebox
```

## Configuration

### Environment Variables

```bash
# Set log level (debug, info, warn, error, silent)
LOG_LEVEL=debug

# Production default
NODE_ENV=production  # Defaults to warn level
```

### Development

In development mode (`NODE_ENV=development`), the default log level is `info`, showing general application flow without overwhelming detail.

### Production

In production, the default log level is `warn`, logging only warnings and errors to reduce noise and improve performance.

## Best Practices

1. **Always use source tags**: Help identify log origin
   ```typescript
   logger.info('Message here', 'module-name');
   ```

2. **Use appropriate log levels**:
   - `debug`: Detailed diagnostics, verbose state information
   - `info`: Normal application flow, significant events
   - `warn`: Recoverable issues, deprecated usage
   - `error`: Errors requiring attention

3. **Structured logging**: Include relevant context
   ```typescript
   logger.info(`Processing ${count} items for patient ${patientId}`, 'processor');
   ```

4. **Error logging**: Include error details
   ```typescript
   logger.error(`Failed to parse DICOM: ${error.message}`, 'dicom');
   ```

5. **Avoid sensitive data**: Never log passwords, tokens, or PHI

## Migration Notes

### Legacy Console Statements

The codebase contains ~1700 `console.log/error/warn` statements. These should be progressively migrated to use the centralized logger:

**Before:**
```typescript
console.log('Processing file:', filename);
console.error('Failed:', error);
```

**After:**
```typescript
import { logger } from './logger';

logger.info(`Processing file: ${filename}`, 'upload');
logger.error(`Failed: ${error.message}`, 'upload');
```

### Priority Migration Order

1. **Critical paths**: Error handling, database operations
2. **User-facing features**: Upload, patient management, fusion
3. **Diagnostic paths**: Debug endpoints, development tools
4. **Legacy/unused code**: Lower priority

## Monitoring & Debugging

### Viewing Logs in Development

```bash
# Start server with debug logging
LOG_LEVEL=debug npm run dev

# Filter logs by source
npm run dev 2>&1 | grep '\[fusebox\]'
```

### Production Monitoring

Logs are formatted for easy parsing by log aggregation tools:

```
[2025-09-29T20:03:45.017Z] [server] INFO: 🚀 Server running on port 5173
[2025-09-29T20:10:15.851Z] [upload] DEBUG: Processing 15 DICOM files
[2025-09-29T20:10:16.123Z] [db] ERROR: Connection timeout after 5000ms
```

## Future Enhancements

1. **Log rotation**: Implement file-based logging with rotation
2. **External services**: Integration with Datadog, Sentry, CloudWatch
3. **Performance metrics**: Add timing instrumentation
4. **Structured JSON**: Support JSON logging format for better parsing
5. **Request tracing**: Add correlation IDs for request tracking
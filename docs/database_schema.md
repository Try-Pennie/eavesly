# Database Schema Documentation

## Overview

The Eavesly Call QA system uses Supabase (PostgreSQL) for data persistence. This document describes the database schema with emphasis on the **new dedicated tables** created to avoid any disruption to existing production systems.

## Design Philosophy

### Zero-Downtime Approach
To ensure **zero production impact**, all new API implementation uses dedicated tables with the `eavesly_` prefix, completely separate from existing production tables. This approach:

- ✅ Eliminates risk of production data corruption
- ✅ Allows parallel operation of old and new systems
- ✅ Enables safe rollback if needed
- ✅ Provides clear separation of concerns

### Table Naming Convention
- **Production tables**: `eavesly_calls`, `eavesly_transcriptions`, `eavesly_transcription_qa`
- **New API tables**: `eavesly_evaluation_results`, `eavesly_api_logs`

## Schema Definition

### eavesly_evaluation_results

**Purpose**: Store complete evaluation results from the new Call QA API

```sql
CREATE TABLE eavesly_evaluation_results (
    id BIGSERIAL PRIMARY KEY,
    call_id TEXT NOT NULL UNIQUE,
    agent_id TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    api_overall_score INTEGER NOT NULL,
    api_evaluation_timestamp TIMESTAMPTZ NOT NULL,
    evaluation_version TEXT NOT NULL DEFAULT 'v1',
    
    -- Evaluation components stored as JSONB
    classification_result JSONB NOT NULL,
    script_deviation_result JSONB NOT NULL,
    compliance_result JSONB NOT NULL,
    communication_result JSONB NOT NULL,
    deep_dive_result JSONB,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Key Features**:
- **UNIQUE constraint** on `call_id` prevents duplicates
- **JSONB columns** store structured evaluation results
- **Correlation tracking** for request tracing
- **Performance metrics** with processing time
- **Version tracking** for evaluation schema evolution

**Indexes**:
```sql
CREATE INDEX idx_eavesly_eval_call_id ON eavesly_evaluation_results(call_id);
CREATE INDEX idx_eavesly_eval_agent_id ON eavesly_evaluation_results(agent_id);
CREATE INDEX idx_eavesly_eval_correlation_id ON eavesly_evaluation_results(correlation_id);
CREATE INDEX idx_eavesly_eval_timestamp ON eavesly_evaluation_results(api_evaluation_timestamp);
```

### eavesly_api_logs

**Purpose**: Track API request metadata for monitoring and debugging

```sql
CREATE TABLE eavesly_api_logs (
    id BIGSERIAL PRIMARY KEY,
    correlation_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    http_method TEXT NOT NULL DEFAULT 'POST',
    http_status_code INTEGER NOT NULL,
    processing_time_ms INTEGER NOT NULL,
    error_message TEXT,
    request_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Key Features**:
- **Non-blocking logging** - failures don't break main API flow
- **Correlation tracking** for request tracing
- **Performance monitoring** with processing times
- **Error tracking** with optional error messages
- **HTTP metadata** for request analysis

**Indexes**:
```sql
CREATE INDEX idx_eavesly_api_logs_correlation_id ON eavesly_api_logs(correlation_id);
CREATE INDEX idx_eavesly_api_logs_timestamp ON eavesly_api_logs(request_timestamp);
```

## Data Flow

### Evaluation Result Storage
```
API Request → Evaluation Processing → store_evaluation_result() → eavesly_evaluation_results
     ↓
log_api_request() → eavesly_api_logs
```

### Query Patterns
- **By Call ID**: `SELECT * FROM eavesly_evaluation_results WHERE call_id = ?`
- **By Agent**: `SELECT * FROM eavesly_evaluation_results WHERE agent_id = ?`
- **By Date Range**: `SELECT * FROM eavesly_evaluation_results WHERE api_evaluation_timestamp BETWEEN ? AND ?`
- **Performance Analysis**: `SELECT AVG(processing_time_ms) FROM eavesly_api_logs WHERE endpoint = ?`

## Security

### Row Level Security (RLS)
Both tables have RLS enabled:
```sql
ALTER TABLE eavesly_evaluation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE eavesly_api_logs ENABLE ROW LEVEL SECURITY;
```

### Access Patterns
- **Service Role Key**: Full read/write access for API operations
- **Anonymous Key**: No direct access (API-mediated only)

## Migration Strategy

### Current State
- ✅ New tables created with migration `create_eavesly_api_tables`
- ✅ Indexes and RLS configured
- ✅ Production tables remain unchanged

### Deployment Process
1. **Deploy new API** with updated table references
2. **Test functionality** with new tables
3. **Monitor performance** and data integrity
4. **Gradual migration** if needed (future phase)

### Rollback Plan
If issues arise:
1. **Revert API deployment** to previous version
2. **New tables remain** for future use
3. **Zero impact** on existing production systems

## Performance Considerations

### Query Performance
- **Indexes** on all major query columns
- **JSONB** for flexible schema evolution
- **Correlation IDs** for efficient request tracing

### Storage
- **JSONB compression** reduces storage overhead
- **Timestamp indexing** for time-series analysis
- **Proper normalization** while maintaining query performance

## Monitoring

### Health Checks
The `DatabaseService.health_check()` method tests:
- **Database connectivity**
- **Basic query functionality**
- **Table accessibility**

### Metrics to Monitor
- **Query performance** (processing_time_ms)
- **Error rates** (via api_logs)
- **Storage growth** (table sizes)
- **Index usage** (query plans)

## Future Considerations

### Schema Evolution
- **evaluation_version** field allows for schema migrations
- **JSONB** provides flexibility for new evaluation criteria
- **Separate tables** enable independent evolution

### Data Retention
Consider implementing:
- **Automated archiving** for old records
- **Partitioning** by date for large datasets
- **Backup strategies** for compliance

---

## Summary

The new database schema provides:
- ✅ **Zero production impact** through table separation
- ✅ **Comprehensive evaluation storage** with JSONB flexibility
- ✅ **Performance monitoring** through API logs
- ✅ **Scalability** through proper indexing
- ✅ **Security** through RLS
- ✅ **Flexibility** for future requirements
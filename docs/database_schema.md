# Database Schema Documentation

## Overview

The Eavesly Call QA system uses Supabase (PostgreSQL) for data persistence. This document describes the database schema used by the API.

## Design Philosophy

### Zero-Downtime Approach
All tables use the `eavesly_` prefix to ensure clear separation from other production tables. This approach:

- Eliminates risk of production data corruption
- Allows parallel operation of old and new systems
- Enables safe rollback if needed
- Provides clear separation of concerns

## Tables

### eavesly_module_results

**Purpose**: Store evaluation results from all QA modules (full_qa, budget_inputs, warm_transfer).

**Columns**:
- `call_id` (TEXT, NOT NULL) - Unique identifier for the call
- `module_name` (TEXT, NOT NULL) - Which evaluation module produced this result
- `result_json` (JSONB, NOT NULL) - Complete structured evaluation result
- `has_violation` (BOOLEAN, NOT NULL) - Whether a violation was detected
- `violation_type` (TEXT) - Type of violation if applicable
- `alert_sent` (BOOLEAN) - Whether an alert was dispatched
- `alert_sent_at` (TIMESTAMPTZ) - When the alert was sent
- `processing_time_ms` (INTEGER) - Time taken for evaluation
- `agent_email` (TEXT) - Agent's email address from Regal
- `contact_name` (TEXT) - Contact name from Regal
- `contact_phone` (TEXT) - Contact phone from Regal
- `recording_link` (TEXT) - Call recording URL from Regal
- `call_summary` (TEXT) - Call summary from Regal
- `transcript_url` (TEXT) - Transcript URL from Regal
- `sfdc_lead_id` (TEXT) - Salesforce Lead ID from Regal

**Unique constraint**: `(call_id, module_name)` - prevents duplicate evaluations per call per module. Upsert operations use this constraint.

**Used by**: `DatabaseService.storeModuleResult()` in `src/services/database.ts`

### eavesly_transcription_qa

**Purpose**: Store full QA results in a format compatible with the existing transcription QA system.

**Columns**:
- `call_id` (TEXT, NOT NULL, UNIQUE) - Unique identifier for the call
- `qa_result` (JSONB) - Complete QA evaluation result
- `processing_time_ms` (INTEGER) - Time taken for evaluation
- `created_at` (TIMESTAMPTZ) - When the record was created

**Unique constraint**: `call_id` - one QA result per call. Upsert operations use this constraint.

**Used by**: `DatabaseService.storeQAResult()` in `src/services/database.ts` (only for `full_qa` module)

## Data Flow

```
API Request -> Module Evaluation -> storeModuleResult() -> eavesly_module_results
                                 -> storeQAResult()     -> eavesly_transcription_qa (full_qa only)
```

## Security

### Row Level Security (RLS)
Both tables have RLS enabled. Access is mediated through the service role key only.

### Access Patterns
- **Service Role Key**: Full read/write access for API operations
- **Anonymous Key**: No direct access (API-mediated only)

## Health Checks

The `DatabaseService.healthCheck()` method tests database connectivity by running a simple query against `eavesly_module_results`.

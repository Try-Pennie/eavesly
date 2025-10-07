# Scripts Directory

This directory contains deployment, testing, and integration scripts for the Eavesly project.

## Contents

### Testing & Deployment

- **test_docker_deployment.sh** - Comprehensive Docker deployment test suite
  - Tests the Docker deployment using test payloads
  - Validates all endpoints and functionality
  - Usage: `cd scripts && ./test_docker_deployment.sh`

- **docker-compose.yml** - Docker Compose configuration for local testing
  - Used by the test deployment script
  - Not used for production (deployed to Fly.io)
  - Usage: `docker-compose -f scripts/docker-compose.yml up`

### Integrations

- **integrations/pipedream_transform.js** - Pipedream data transformation script
  - Transforms data from Supabase and Salesforce
  - Formats data for the Eavesly `/evaluate-call` API endpoint
  - Copy this code into your Pipedream workflow

## Running Scripts

All scripts should be run from the project root directory unless otherwise specified.

For Docker testing:
```bash
cd scripts
./test_docker_deployment.sh
```

For Docker Compose:
```bash
docker-compose -f scripts/docker-compose.yml up
```

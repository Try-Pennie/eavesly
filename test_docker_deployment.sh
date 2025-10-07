#!/bin/bash

# ============================================================================
# Eavesly Docker Deployment Test Suite
# ============================================================================
# This script thoroughly tests the Docker deployment using test_payloads.json
# to ensure everything is ready for production deployment.
# ============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
CONTAINER_NAME="eavesly-test"
BASE_URL="http://localhost:3000"
API_KEY=""  # Will be read from .env file
TEST_RESULTS_FILE="test_results.log"
TIMEOUT=30

# Initialize test results log
echo "Docker Deployment Test Results - $(date)" > $TEST_RESULTS_FILE
echo "=================================================" >> $TEST_RESULTS_FILE

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
    echo "$message" >> $TEST_RESULTS_FILE
}

# Function to check if API key is set
check_api_key() {
    if [ -f .env ]; then
        API_KEY=$(grep "INTERNAL_API_KEY=" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
        if [ -z "$API_KEY" ] || [ "$API_KEY" = "your_secure_internal_api_key_here" ]; then
            print_status $RED "ERROR: INTERNAL_API_KEY not set in .env file"
            echo "Please set a valid API key in your .env file"
            exit 1
        fi
    else
        print_status $RED "ERROR: .env file not found"
        echo "Please create a .env file with required configuration"
        exit 1
    fi
}

# Function to wait for service to be ready
wait_for_service() {
    local max_attempts=60
    local attempt=1
    
    print_status $BLUE "Waiting for service to be ready..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
            print_status $GREEN "✓ Service is ready after $attempt attempts"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    print_status $RED "✗ Service failed to start after $max_attempts attempts"
    docker-compose logs eavesly
    exit 1
}

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local expected_status=$3
    local description=$4
    local headers=$5
    local data=$6
    
    print_status $BLUE "Testing: $description"
    
    local curl_cmd="curl -s -w 'HTTP_STATUS:%{http_code}' -X $method"
    
    if [ ! -z "$headers" ]; then
        curl_cmd="$curl_cmd $headers"
    fi
    
    if [ ! -z "$data" ]; then
        curl_cmd="$curl_cmd -d '$data'"
    fi
    
    curl_cmd="$curl_cmd $BASE_URL$endpoint"
    
    local response=$(eval $curl_cmd)
    local body=$(echo "$response" | sed 's/HTTP_STATUS:.*$//')
    local status=$(echo "$response" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
    
    if [ "$status" = "$expected_status" ]; then
        print_status $GREEN "✓ $description - Status: $status"
        if [ ! -z "$body" ] && [ "$body" != "null" ]; then
            echo "  Response preview: $(echo "$body" | head -c 100)..."
        fi
        return 0
    else
        print_status $RED "✗ $description - Expected: $expected_status, Got: $status"
        echo "  Response: $body"
        return 1
    fi
}

# Function to test with JSON data from file
test_with_payload() {
    local endpoint=$1
    local payload_key=$2
    local description=$3
    local expected_status=${4:-200}
    
    print_status $BLUE "Testing: $description"
    
    # Extract payload from test_payloads.json
    local payload=$(cat test_payloads.json | jq ".${payload_key}.payload")
    
    if [ "$payload" = "null" ]; then
        print_status $RED "✗ Payload not found for key: $payload_key"
        return 1
    fi
    
    local response=$(curl -s -w 'HTTP_STATUS:%{http_code}' -X POST \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "$payload" \
        "$BASE_URL$endpoint")
    
    local body=$(echo "$response" | sed 's/HTTP_STATUS:.*$//')
    local status=$(echo "$response" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
    
    if [ "$status" = "$expected_status" ]; then
        print_status $GREEN "✓ $description - Status: $status"
        echo "  Response preview: $(echo "$body" | head -c 150)..."
        
        # Additional validation for successful responses
        if [ "$status" = "200" ]; then
            local correlation_id=$(echo "$body" | jq -r '.correlation_id // empty')
            if [ ! -z "$correlation_id" ]; then
                echo "  Correlation ID: $correlation_id"
            fi
        fi
        return 0
    else
        print_status $RED "✗ $description - Expected: $expected_status, Got: $status"
        echo "  Response: $body"
        return 1
    fi
}

# Function to check container health
check_container_health() {
    print_status $BLUE "Checking container health..."
    
    local health_status=$(docker inspect --format='{{.State.Health.Status}}' $CONTAINER_NAME 2>/dev/null || echo "no-healthcheck")
    
    if [ "$health_status" = "healthy" ]; then
        print_status $GREEN "✓ Container is healthy"
        return 0
    else
        print_status $YELLOW "! Container health status: $health_status"
        return 0  # Don't fail the test for this
    fi
}

# Function to check resource usage
check_resource_usage() {
    print_status $BLUE "Checking resource usage..."
    
    local stats=$(docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" $CONTAINER_NAME)
    echo "$stats"
    echo "$stats" >> $TEST_RESULTS_FILE
}

# Main test execution
main() {
    print_status $BLUE "Starting Eavesly Docker Deployment Test Suite"
    print_status $BLUE "=============================================="
    
    # Check prerequisites
    print_status $BLUE "\n1. Checking prerequisites..."
    check_api_key
    
    if ! command -v docker-compose &> /dev/null; then
        print_status $RED "ERROR: docker-compose not found. Please install Docker Compose."
        exit 1
    fi
    
    if ! command -v jq &> /dev/null; then
        print_status $RED "ERROR: jq not found. Please install jq for JSON processing."
        exit 1
    fi
    
    print_status $GREEN "✓ All prerequisites met"
    
    # Build and start containers
    print_status $BLUE "\n2. Building and starting containers..."
    docker-compose down -v >/dev/null 2>&1 || true
    docker-compose up --build -d
    
    # Wait for service to be ready
    wait_for_service
    
    # Check container health
    print_status $BLUE "\n3. Container health checks..."
    check_container_health
    check_resource_usage
    
    # Test basic endpoints
    print_status $BLUE "\n4. Testing basic endpoints..."
    test_endpoint "GET" "/health" "200" "Health check endpoint"
    test_endpoint "GET" "/" "200" "Root endpoint"
    test_endpoint "GET" "/config" "200" "Config endpoint"
    
    # Test authentication
    print_status $BLUE "\n5. Testing authentication..."
    test_endpoint "POST" "/api/v1/evaluate-call" "401" "No API key" \
        "-H 'Content-Type: application/json'" \
        '{"call_id": "test"}'
    
    test_endpoint "POST" "/api/v1/evaluate-call" "401" "Invalid API key" \
        "-H 'Content-Type: application/json' -H 'X-API-Key: invalid'" \
        '{"call_id": "test"}'
    
    # Test with actual payloads
    print_status $BLUE "\n6. Testing single call evaluation..."
    test_with_payload "/api/v1/evaluate-call" "single_call_evaluation" "High-quality call scenario"
    test_with_payload "/api/v1/evaluate-call" "minimal_payload" "Minimal payload scenario"
    
    # Test batch evaluation
    print_status $BLUE "\n7. Testing batch evaluation..."
    test_with_payload "/api/v1/evaluate-batch" "batch_evaluation" "Batch evaluation scenario"
    
    # Test error handling
    print_status $BLUE "\n8. Testing error handling..."
    test_endpoint "POST" "/api/v1/evaluate-call" "422" "Malformed JSON" \
        "-H 'Content-Type: application/json' -H 'X-API-Key: $API_KEY'" \
        '{"invalid": json}'
    
    test_endpoint "POST" "/api/v1/evaluate-call" "422" "Missing required fields" \
        "-H 'Content-Type: application/json' -H 'X-API-Key: $API_KEY'" \
        '{}'
    
    # Check logs
    print_status $BLUE "\n9. Checking application logs..."
    echo "Recent logs:" >> $TEST_RESULTS_FILE
    docker-compose logs --tail=20 eavesly >> $TEST_RESULTS_FILE
    
    # Final resource check
    print_status $BLUE "\n10. Final resource usage check..."
    check_resource_usage
    
    print_status $GREEN "\n=============================================="
    print_status $GREEN "Docker deployment tests completed successfully!"
    print_status $BLUE "Check $TEST_RESULTS_FILE for detailed results"
    
    # Cleanup option
    read -p "Do you want to stop the containers? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_status $BLUE "Stopping containers..."
        docker-compose down
        print_status $GREEN "Containers stopped"
    else
        print_status $BLUE "Containers are still running at $BASE_URL"
        print_status $BLUE "Use 'docker-compose down' to stop them later"
    fi
}

# Run main function
main "$@"
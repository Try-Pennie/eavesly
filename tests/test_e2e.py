#!/usr/bin/env python3
"""
End-to-End Test Script for Eavesly API
"""
import requests
import json
import time

# Test configuration
BASE_URL = "http://localhost:3000"
API_KEY = "test_internal_key_12345678"

def test_health_check():
    """Test health check endpoint"""
    print("Testing health check...")
    response = requests.get(f"{BASE_URL}/health")
    print(f"Health check status: {response.status_code}")
    
    if response.status_code == 200:
        health = response.json()
        print(f"Health status: {health['status']}")
        print(f"Database: {health['dependencies']['database']}")
        print(f"Orchestrator: {health['dependencies']['orchestrator']}")
        return health['status'] == 'healthy'
    return False

def test_api_evaluation():
    """Test the main evaluation endpoint"""
    print("\nTesting evaluation endpoint...")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}"
    }
    
    payload = {
        "call_id": f"test_call_{int(time.time())}",
        "agent_id": "agent_test_001",
        "call_context": "First Call",
        "transcript": {
            "transcript": "Agent: Hello, this is Sarah from Pennie. I understand you're interested in our loan services. Can I get your name? Client: Yes, it's John Smith. Agent: Great John, let me tell you about our current rates...",
            "metadata": {
                "duration": 60,
                "timestamp": "2024-01-15T10:30:00Z",
                "talk_time": 50,
                "disposition": "completed"
            }
        },
        "ideal_script": "Section 1: Introduction and greeting\\nSection 2: Needs assessment\\nSection 3: Product presentation",
        "client_data": {
            "lead_id": "lead_test_123",
            "script_progress": {
                "sections_attempted": [1, 2, 3],
                "last_completed_section": 3,
                "termination_reason": "completed"
            },
            "financial_profile": {
                "annual_income": 50000.0,
                "dti_ratio": 0.3,
                "loan_approval_status": "pending"
            }
        }
    }
    
    print("Sending evaluation request...")
    response = requests.post(f"{BASE_URL}/api/v1/evaluate-call", 
                           headers=headers, 
                           json=payload)
    
    print(f"Response status: {response.status_code}")
    
    if response.status_code == 200:
        result = response.json()
        print(f"Call ID: {result['call_id']}")
        print(f"Correlation ID: {result['correlation_id']}")
        print(f"Overall Score: {result['overall_score']}")
        print(f"Processing Time: {result['processing_time_ms']}ms")
        print("Evaluation completed successfully!")
        return True
    else:
        print(f"Error: {response.text}")
        return False

def test_root_endpoint():
    """Test root endpoint"""
    print("\nTesting root endpoint...")
    response = requests.get(f"{BASE_URL}/")
    print(f"Root endpoint status: {response.status_code}")
    
    if response.status_code == 200:
        root = response.json()
        print(f"API: {root['message']}")
        print(f"Version: {root['version']}")
        return True
    return False

def main():
    """Run all end-to-end tests"""
    print("🚀 Starting End-to-End Tests for Eavesly API")
    print("=" * 50)
    
    tests = [
        ("Health Check", test_health_check),
        ("Root Endpoint", test_root_endpoint),
        ("API Evaluation", test_api_evaluation)
    ]
    
    results = {}
    
    for test_name, test_func in tests:
        try:
            results[test_name] = test_func()
        except Exception as e:
            print(f"❌ {test_name} failed with error: {e}")
            results[test_name] = False
    
    print("\n" + "=" * 50)
    print("📊 Test Results Summary:")
    
    all_passed = True
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} {test_name}")
        if not passed:
            all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("🎉 All tests PASSED! The system is ready for production.")
    else:
        print("⚠️  Some tests FAILED. Please check the issues before deployment.")
    
    return all_passed

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
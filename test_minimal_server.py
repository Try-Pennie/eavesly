#!/usr/bin/env python3
"""
Test script for the minimal server
"""

import asyncio
import sys

import httpx

# Colors for output
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    YELLOW = '\033[93m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'

def print_colored(text: str, color: str = Colors.RESET):
    print(f"{color}{text}{Colors.RESET}")

def print_header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{text.center(60)}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'='*60}{Colors.RESET}")

async def test_endpoints():
    """Test all minimal server endpoints"""
    print_header("Testing Minimal Server Endpoints")
    
    base_url = "http://localhost:3001"
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        
        # Test root endpoint
        print_colored("1️⃣ Testing root endpoint...", Colors.BLUE)
        try:
            response = await client.get(f"{base_url}/")
            if response.status_code == 200:
                data = response.json()
                print_colored("✅ Root endpoint working", Colors.GREEN)
                print_colored(f"   Message: {data['message']}", Colors.GREEN)
                print_colored(f"   Version: {data['version']}", Colors.GREEN)
            else:
                print_colored(f"❌ Root endpoint failed: {response.status_code}", Colors.RED)
                return False
        except Exception as e:
            print_colored(f"❌ Root endpoint error: {e}", Colors.RED)
            return False
        
        # Test health endpoint
        print_colored("\n2️⃣ Testing health endpoint...", Colors.BLUE)
        try:
            response = await client.get(f"{base_url}/health")
            if response.status_code in [200, 503]:  # Both OK and degraded are acceptable
                data = response.json()
                print_colored(f"✅ Health endpoint working", Colors.GREEN)
                print_colored(f"   Status: {data['status']}", Colors.GREEN)
                print_colored(f"   Database: {data['dependencies']['database']}", Colors.GREEN)
            else:
                print_colored(f"❌ Health endpoint failed: {response.status_code}", Colors.RED)
                return False
        except Exception as e:
            print_colored(f"❌ Health endpoint error: {e}", Colors.RED)
            return False
        
        # Test database endpoint
        print_colored("\n3️⃣ Testing database endpoint...", Colors.BLUE)
        try:
            response = await client.post(f"{base_url}/test-db")
            if response.status_code == 200:
                data = response.json()
                print_colored("✅ Database endpoint working", Colors.GREEN)
                print_colored(f"   Status: {data['status']}", Colors.GREEN)
                print_colored(f"   Correlation ID: {data['correlation_id']}", Colors.GREEN)
                print_colored(f"   Operations: {', '.join(data['operations_performed'])}", Colors.GREEN)
            else:
                print_colored(f"❌ Database endpoint failed: {response.status_code}", Colors.RED)
                try:
                    error_data = response.json()
                    print_colored(f"   Error: {error_data}", Colors.RED)
                except:
                    print_colored(f"   Response: {response.text}", Colors.RED)
                return False
        except Exception as e:
            print_colored(f"❌ Database endpoint error: {e}", Colors.RED)
            return False
        
        return True

async def main():
    """Main test runner"""
    print_colored(f"{Colors.BOLD}🧪 Minimal Server Test Suite{Colors.RESET}")
    print_colored("Testing minimal API server at http://localhost:3001")
    
    success = await test_endpoints()
    
    print_header("Test Results")
    
    if success:
        print_colored("🎉 All tests passed!", Colors.GREEN)
        print_colored("✅ Root endpoint functional", Colors.GREEN)
        print_colored("✅ Health endpoint working", Colors.GREEN)
        print_colored("✅ Database endpoint operational", Colors.GREEN)
        print_colored("\n✨ The database integration is working correctly!", Colors.GREEN)
    else:
        print_colored("❌ Some tests failed", Colors.RED)
    
    return success

if __name__ == "__main__":
    try:
        success = asyncio.run(main())
        sys.exit(0 if success else 1)
    except Exception as e:
        print_colored(f"\n💥 Unexpected error: {e}", Colors.RED)
        sys.exit(1)